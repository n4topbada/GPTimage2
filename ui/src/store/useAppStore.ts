import { create } from "zustand";
import type { CanvasExportBackground, HexColor } from "../types/canvas";
import type {
  Count,
  Format,
  GenerateItem,
  GenerateResponse,
  HistoryStripLayout,
  EmbeddedGenerationMetadata,
  ImageModel,
  Moderation,
  MultimodeGenerateResponse,
  MultimodeSequenceStatus,
  Provider,
  Quality,
  ResolvedTheme,
  SettingsSection,
  SizePreset,
  ThemeFamily,
  ThemePreference,
} from "../types";
import { THEME_FAMILIES } from "../types";
import { isMultiResponse } from "../types";
import {
  postGenerate,
  postEdit,
  postMultimodeGenerateStream,
  getHistory,
  getInflight,
  clearInflightTerminalJobs,
  readImageMetadata,
  getBrowserId,
  deleteHistoryItem,
  restoreHistoryItem,
  permanentlyDeleteHistoryItem,
  getPromptLibrary,
  createPrompt,
  updatePrompt,
  deletePrompt,
  togglePromptFavorite,
  toggleGalleryFavorite,
  importPromptLibrary,
  importLocalImage,
} from "../lib/api";
import { readFileAsDataURL } from "../lib/image";
import { compressToBase64, isHeic, hasAlphaChannel } from "../lib/compress";
import {
  normalizeCustomSizePairDetailed,
  parseRequestedCustomSide,
  type CustomSizeAdjustmentReason,
} from "../lib/size";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_STORAGE_KEY,
  isImageModel,
} from "../lib/imageModels";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_STORAGE_KEY,
  isReasoningEffort,
  type ReasoningEffort,
} from "../lib/reasoning";
import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_STORAGE_KEY,
} from "../lib/webSearch";
import {
  DEFAULT_POSE_PRESETS,
  jitterPoseSectionOrderForRetry,
  normalizePosePresets,
  replacePoseSection,
  type PosePreset,
} from "../lib/poseVariants";
import { t, loadLocale, saveLocale, type Locale } from "../i18n";
import type { ImaErrorCode } from "../lib/errorCodes";
import { handleError } from "../lib/errorHandler";
import {
  getNeighborAfterRemoval,
  getShortcutTarget,
  getVisibleGalleryItems,
  resolveVisibleShortcutCurrent,
  type GalleryShortcutAction,
} from "../lib/galleryShortcuts";

function loadRightPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem("ima2.rightPanelOpen");
    if (raw === null) return true;
    return JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem("ima2:theme");
    if (raw === "system" || raw === "dark" || raw === "light") return raw;
  } catch {}
  return "system";
}

function loadThemeFamily(): ThemeFamily {
  try {
    const raw = localStorage.getItem("ima2:themeFamily");
    if (raw && (THEME_FAMILIES as readonly string[]).includes(raw)) {
      return raw as ThemeFamily;
    }
  } catch {}
  return "default";
}

function loadHistoryStripLayout(): HistoryStripLayout {
  try {
    const raw = localStorage.getItem("ima2.historyStripLayout");
    if (raw === "rail" || raw === "horizontal" || raw === "sidebar") return raw;
  } catch {}
  return "rail";
}

const CANVAS_EXPORT_BG_KEY = "ima2.canvas.exportBackground.v1";

function loadCanvasExportBackground(): {
  mode: CanvasExportBackground;
  matteColor: HexColor;
} {
  if (typeof window === "undefined")
    return { mode: "alpha", matteColor: "#ffffff" };
  try {
    const raw = window.localStorage.getItem(CANVAS_EXPORT_BG_KEY);
    if (!raw) return { mode: "alpha", matteColor: "#ffffff" };
    const parsed = JSON.parse(raw) as Partial<{
      mode: CanvasExportBackground;
      matteColor: string;
    }>;
    const mode: CanvasExportBackground =
      parsed.mode === "matte" ? "matte" : "alpha";
    const matteColor: HexColor =
      typeof parsed.matteColor === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(parsed.matteColor)
        ? (parsed.matteColor as HexColor)
        : "#ffffff";
    return { mode, matteColor };
  } catch {
    return { mode: "alpha", matteColor: "#ffffff" };
  }
}

function persistCanvasExportBackground(
  mode: CanvasExportBackground,
  matteColor: HexColor,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CANVAS_EXPORT_BG_KEY,
      JSON.stringify({ mode, matteColor }),
    );
  } catch {
    /* ignore quota / unavailable */
  }
}

function loadImageModel(): ImageModel {
  try {
    const raw = localStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
    if (isImageModel(raw)) return raw;
  } catch {}
  return DEFAULT_IMAGE_MODEL;
}

function saveImageModel(model: ImageModel): void {
  try {
    localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, model);
  } catch {}
}

function loadReasoningEffort(): ReasoningEffort {
  try {
    const raw = localStorage.getItem(REASONING_EFFORT_STORAGE_KEY);
    if (isReasoningEffort(raw)) return raw;
  } catch {}
  return DEFAULT_REASONING_EFFORT;
}

function saveReasoningEffort(effort: ReasoningEffort): void {
  try {
    localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, effort);
  } catch {}
}

function loadWebSearchEnabled(): boolean {
  try {
    const raw = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {}
  return DEFAULT_WEB_SEARCH_ENABLED;
}

function saveWebSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(enabled));
  } catch {}
}

const GENERATION_DEFAULTS_STORAGE_KEY = "ima2.generationDefaults";

function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme === "dark" || theme === "light") return theme;
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

type PersistedInFlight = {
  id: string;
  prompt: string;
  startedAt: number;
  phase?: string;
  terminal?: boolean;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  httpStatus?: number;
  durationMs?: number;
  finishedAt?: number;
  meta?: Record<string, unknown>;
  sessionId?: string | null;
  parentNodeId?: string | null;
  clientNodeId?: string | null;
  kind?: "classic" | "node" | "multimode";
};

export type GenerationFailureLog = {
  id: string;
  prompt: string;
  startedAt: number;
  finishedAt: number;
  phase?: string;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  httpStatus?: number;
  durationMs?: number;
  kind?: "classic" | "node" | "multimode";
  meta?: Record<string, unknown>;
};

const FAILURE_LOG_STORAGE_KEY = "ima2.failureLogs";
const POSE_PRESET_STORAGE_KEY = "ima2.posePresets.v2";
const MAX_FAILURE_LOGS = 100;
const INFLIGHT_TTL_MS = 180_000;
const TERMINAL_INFLIGHT_DISPLAY_MS = 60_000;
const SERVER_MISSING_INFLIGHT_GRACE_MS = 10_000;
const PENDING_DELETED_FILENAME_TTL_MS = 60_000;
const pendingDeletedFilenames = new Set<string>();

function isStaleInflightRecord(value: { errorCode?: unknown } | null | undefined): boolean {
  return value?.errorCode === "STALE_INFLIGHT";
}

type ServerInFlightJob = {
  requestId: string;
  kind?: string;
  prompt?: string;
  startedAt: number;
  phase?: string;
  meta?: Record<string, unknown>;
};

type ServerTerminalJob = ServerInFlightJob & {
  status?: "completed" | "error" | "canceled";
  finishedAt?: number;
  durationMs?: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
};

type InsertedPrompt = {
  id: string;
  name: string;
  text: string;
};

function composePrompt(
  mainPrompt: string,
  insertedPrompts: InsertedPrompt[],
): string {
  return [
    ...insertedPrompts.map((prompt) => prompt.text.trim()).filter(Boolean),
    mainPrompt.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function toPersistedInFlightJob(job: ServerInFlightJob): PersistedInFlight {
  const meta = job.meta ?? {};
  const kind =
    job.kind === "classic" || job.kind === "node" || job.kind === "multimode"
      ? job.kind
      : meta.kind === "classic" ||
          meta.kind === "node" ||
          meta.kind === "multimode"
        ? meta.kind
        : undefined;
  return {
    id: job.requestId,
    prompt: typeof job.prompt === "string" ? job.prompt : "",
    startedAt: job.startedAt,
    phase: typeof job.phase === "string" ? job.phase : undefined,
    sessionId: typeof meta.sessionId === "string" ? meta.sessionId : null,
    parentNodeId:
      typeof meta.parentNodeId === "string" ? meta.parentNodeId : null,
    clientNodeId:
      typeof meta.clientNodeId === "string" ? meta.clientNodeId : null,
    kind,
  };
}

function loadInFlight(): PersistedInFlight[] {
  try {
    const raw = localStorage.getItem("ima2.inFlight");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr
      .filter(
        (x) =>
          x &&
          typeof x.id === "string" &&
          typeof x.prompt === "string" &&
          typeof x.startedAt === "number" &&
          !isStaleInflightRecord(x) &&
          isInFlightVisible(x as PersistedInFlight, now),
      )
      .map((x) => ({
        id: x.id,
        prompt: x.prompt,
        startedAt: x.startedAt,
        phase: typeof x.phase === "string" ? x.phase : undefined,
        terminal: x.terminal === true,
        errorCode: typeof x.errorCode === "string" ? x.errorCode : undefined,
        errorMessage:
          typeof x.errorMessage === "string" ? x.errorMessage : undefined,
        httpStatus:
          typeof x.httpStatus === "number" ? x.httpStatus : undefined,
        durationMs:
          typeof x.durationMs === "number" ? x.durationMs : undefined,
        finishedAt:
          typeof x.finishedAt === "number" ? x.finishedAt : undefined,
        meta:
          x.meta && typeof x.meta === "object" && !Array.isArray(x.meta)
            ? (x.meta as Record<string, unknown>)
            : undefined,
        sessionId: typeof x.sessionId === "string" ? x.sessionId : null,
        parentNodeId:
          typeof x.parentNodeId === "string" ? x.parentNodeId : null,
        clientNodeId:
          typeof x.clientNodeId === "string" ? x.clientNodeId : null,
        kind:
          x.kind === "classic" || x.kind === "node" || x.kind === "multimode"
            ? x.kind
            : undefined,
      }));
  } catch {
    return [];
  }
}

function isInFlightVisible(job: PersistedInFlight, now = Date.now()): boolean {
  if (job.terminal) {
    const finishedAt =
      typeof job.finishedAt === "number" ? job.finishedAt : job.startedAt;
    return now - finishedAt < TERMINAL_INFLIGHT_DISPLAY_MS;
  }
  return true;
}

function pruneInFlight(list: PersistedInFlight[], now = Date.now()): PersistedInFlight[] {
  return list.filter((f) => isInFlightVisible(f, now));
}

function pruneTerminalInFlight(list: PersistedInFlight[], now = Date.now()): PersistedInFlight[] {
  return list.filter((f) => !f.terminal || isInFlightVisible(f, now));
}

function pruneRecoverableInFlight(list: PersistedInFlight[], now = Date.now()): PersistedInFlight[] {
  return list.filter(
    (f) =>
      (f.terminal && isInFlightVisible(f, now)) ||
      (!f.terminal && now - f.startedAt < SERVER_MISSING_INFLIGHT_GRACE_MS),
  );
}

function compactInFlightForStorage(list: PersistedInFlight[], now = Date.now()): PersistedInFlight[] {
  const visible = pruneInFlight(list, now);
  const active = visible.filter((f) => !f.terminal);
  const terminal = visible.filter((f) => f.terminal).slice(-60);
  return [...active, ...terminal].slice(-220);
}

function saveInFlight(list: PersistedInFlight[]): void {
  try {
    localStorage.setItem("ima2.inFlight", JSON.stringify(compactInFlightForStorage(list)));
  } catch (err) {
    // Quota exceeded or storage disabled. Notify the user once per tab.
    const w = window as unknown as { __ima2QuotaWarned?: boolean };
    if (!w.__ima2QuotaWarned) {
      w.__ima2QuotaWarned = true;
      console.warn("[ima2] localStorage write failed:", err);
      try {
        useAppStore.getState().showToast(t("toast.localStorageFull"), true);
      } catch {}
    }
  }
}

function normalizeFailureLog(raw: unknown): GenerationFailureLog | null {
  const x = raw as Partial<GenerationFailureLog> | null;
  if (!x || typeof x.id !== "string") return null;
  if (isStaleInflightRecord(x)) return null;
  if (typeof x.startedAt !== "number" || typeof x.finishedAt !== "number") {
    return null;
  }
  const kind =
    x.kind === "classic" || x.kind === "node" || x.kind === "multimode"
      ? x.kind
      : undefined;
  return {
    id: x.id,
    prompt: typeof x.prompt === "string" ? x.prompt : "",
    startedAt: x.startedAt,
    finishedAt: x.finishedAt,
    phase: typeof x.phase === "string" ? x.phase : undefined,
    errorCode: typeof x.errorCode === "string" ? x.errorCode : undefined,
    errorMessage:
      typeof x.errorMessage === "string" ? x.errorMessage : undefined,
    errorDetails:
      x.errorDetails &&
      typeof x.errorDetails === "object" &&
      !Array.isArray(x.errorDetails)
        ? (x.errorDetails as Record<string, unknown>)
        : undefined,
    httpStatus: typeof x.httpStatus === "number" ? x.httpStatus : undefined,
    durationMs: typeof x.durationMs === "number" ? x.durationMs : undefined,
    kind,
    meta:
      x.meta && typeof x.meta === "object" && !Array.isArray(x.meta)
        ? (x.meta as Record<string, unknown>)
        : undefined,
  };
}

function loadFailureLogs(): GenerationFailureLog[] {
  try {
    const raw = localStorage.getItem(FAILURE_LOG_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(normalizeFailureLog)
      .filter((x): x is GenerationFailureLog => Boolean(x))
      .slice(0, MAX_FAILURE_LOGS);
  } catch {
    return [];
  }
}

function saveFailureLogs(logs: GenerationFailureLog[]): void {
  try {
    localStorage.setItem(
      FAILURE_LOG_STORAGE_KEY,
      JSON.stringify(logs.slice(0, MAX_FAILURE_LOGS)),
    );
  } catch {}
}

function loadPosePresets(): PosePreset[] {
  try {
    const raw = localStorage.getItem(POSE_PRESET_STORAGE_KEY);
    if (!raw) return DEFAULT_POSE_PRESETS;
    return normalizePosePresets(JSON.parse(raw));
  } catch {
    return DEFAULT_POSE_PRESETS;
  }
}

function savePosePresets(presets: PosePreset[]): void {
  try {
    localStorage.setItem(
      POSE_PRESET_STORAGE_KEY,
      JSON.stringify(presets),
    );
  } catch {}
}

function getErrorField(err: unknown, field: "code" | "message"): string | undefined {
  const value = (err as { [key: string]: unknown } | null | undefined)?.[field];
  return typeof value === "string" ? value : undefined;
}

function getErrorDetails(err: unknown): Record<string, unknown> | undefined {
  const details = (err as { details?: unknown } | null | undefined)?.details;
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : undefined;
}

function getErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

function shouldRetryFastReject(err: unknown, startedAt: number): boolean {
  const code = getErrorField(err, "code");
  const status = getErrorStatus(err);
  if (code === "IMAGE_TOOL_FAILED" || status === 502) return true;
  const elapsed = Date.now() - startedAt;
  if (elapsed > 45_000) return false;
  return (
    code === "SAFETY_REFUSAL" ||
    code === "EMPTY_RESPONSE" ||
    code === "OAUTH_UPSTREAM_ERROR" ||
    status === 422
  );
}

function terminalToPersistedInFlight(
  current: PersistedInFlight,
  terminal: ServerTerminalJob,
): PersistedInFlight {
  const isError = terminal.status === "error";
  return {
    ...current,
    phase: isError ? "error" : "completed",
    terminal: true,
    errorCode: typeof terminal.errorCode === "string" ? terminal.errorCode : undefined,
    errorMessage:
      typeof terminal.errorMessage === "string" ? terminal.errorMessage : undefined,
    errorDetails:
      terminal.meta?.errorDetails &&
      typeof terminal.meta.errorDetails === "object" &&
      !Array.isArray(terminal.meta.errorDetails)
        ? (terminal.meta.errorDetails as Record<string, unknown>)
        : undefined,
    httpStatus: typeof terminal.httpStatus === "number" ? terminal.httpStatus : undefined,
    durationMs: typeof terminal.durationMs === "number" ? terminal.durationMs : undefined,
    finishedAt: typeof terminal.finishedAt === "number" ? terminal.finishedAt : Date.now(),
    meta: terminal.meta,
  };
}

function countActiveInFlight(list: PersistedInFlight[]): number {
  return list.filter((f) => !f.terminal).length;
}

function rememberPendingDeletedFilename(filename: string): void {
  pendingDeletedFilenames.add(filename);
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      pendingDeletedFilenames.delete(filename);
    }, PENDING_DELETED_FILENAME_TTL_MS);
  }
}

function loadSelectedFilename(): string | null {
  try {
    const raw = localStorage.getItem("ima2.selectedFilename");
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveSelectedFilename(filename: string | null): void {
  try {
    if (filename) localStorage.setItem("ima2.selectedFilename", filename);
    else localStorage.removeItem("ima2.selectedFilename");
  } catch {}
}

const HISTORY_LIMIT = 500;
const INFLIGHT_HISTORY_POLL_MS = 5000;
const MAX_REFERENCE_IMAGES = 5;
const MAX_CLIENT_GENERATION_POSTS = 10;
let activeClientGenerationPosts = 0;
const clientGenerationPostQueue: Array<() => void> = [];
const clientGenerationPendingIds = new Set<string>();

function acquireGenerationPostSlot(): Promise<() => void> {
  if (activeClientGenerationPosts < MAX_CLIENT_GENERATION_POSTS) {
    activeClientGenerationPosts += 1;
    return Promise.resolve(() => releaseGenerationPostSlot());
  }
  return new Promise((resolve) => {
    clientGenerationPostQueue.push(() => {
      activeClientGenerationPosts += 1;
      resolve(() => releaseGenerationPostSlot());
    });
  });
}

function releaseGenerationPostSlot(): void {
  activeClientGenerationPosts = Math.max(0, activeClientGenerationPosts - 1);
  const next = clientGenerationPostQueue.shift();
  if (next) next();
}

function isClientGenerationPending(id: string): boolean {
  return clientGenerationPendingIds.has(id);
}

async function withGenerationPostSlot<T>(run: () => Promise<T>): Promise<T> {
  const release = await acquireGenerationPostSlot();
  try {
    return await run();
  } finally {
    release();
  }
}

function narrowGenerateKind(k?: string | null): GenerateItem["kind"] {
  return k === "classic" ||
    k === "edit" ||
    k === "generate" ||
    k === "card-news-card" ||
    k === "card-news-set"
    ? k
    : null;
}

function mapHistoryItem(
  it: Awaited<ReturnType<typeof getHistory>>["items"][number],
): GenerateItem {
  return {
    image: it.url,
    url: it.url,
    filename: it.filename,
    thumb: it.url,
    prompt: it.prompt ?? undefined,
    size: it.size ?? undefined,
    quality: it.quality ?? undefined,
    format: it.format as Format | undefined,
    model: it.model ?? undefined,
    provider: it.provider,
    usage: (it.usage as GenerateItem["usage"]) ?? undefined,
    createdAt: it.createdAt,
    sessionId: it.sessionId ?? null,
    nodeId: it.nodeId ?? null,
    clientNodeId: it.clientNodeId ?? null,
    requestId: it.requestId ?? null,
    kind: narrowGenerateKind(it.kind),
    canvasVersion: Boolean(it.canvasVersion),
    canvasSourceFilename: it.canvasSourceFilename ?? null,
    canvasEditableFilename: it.canvasEditableFilename ?? null,
    canvasMergedAt: it.canvasMergedAt ?? undefined,
    setId: it.setId ?? null,
    cardId: it.cardId ?? null,
    cardOrder: it.cardOrder ?? null,
    headline: it.headline ?? null,
    body: it.body ?? null,
    cards: it.cards,
    refsCount: it.refsCount ?? 0,
    isFavorite: it.isFavorite ?? false,
    sequenceId: it.sequenceId ?? null,
    sequenceIndex: it.sequenceIndex ?? null,
    sequenceTotalRequested: it.sequenceTotalRequested ?? null,
    sequenceTotalReturned: it.sequenceTotalReturned ?? null,
    sequenceStatus: it.sequenceStatus ?? null,
  };
}

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

async function compressReferenceSource(
  src: string,
  filename = "reference.png",
): Promise<string> {
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`reference fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  return compressToBase64(file, {
    // Generated PNGs can exceed the server's base64 reference cap. For i2i
    // references, a flattened JPEG is the intended upload format.
    preserveTransparency: false,
  });
}

type ToastState = { message: string; error: boolean; id: number } | null;
type TrashPendingState = {
  filename: string;
  trashId: string;
  item: GenerateItem;
  expiresAt: number;
} | null;

type CustomSizeConfirmState = {
  requestedW: number;
  requestedH: number;
  adjustedW: number;
  adjustedH: number;
  reasons: CustomSizeAdjustmentReason[];
  continuation:
    | { kind: "classic" }
    | { kind: "multimode" };
} | null;

type MetadataRestoreState = {
  filename: string;
  image: string;
  metadata: EmbeddedGenerationMetadata;
  source: "xmp" | "png-comment" | string;
} | null;

export type MultimodeSequenceState = {
  sequenceId: string;
  requestId: string;
  requested: number;
  returned: number;
  images: GenerateItem[];
  partials: Array<{ image: string; index?: number | null }>;
  status: MultimodeSequenceStatus;
  elapsed?: string;
  error?: string | null;
};

type AppState = {
  provider: Provider;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
  imageModel: ImageModel;
  reasoningEffort: ReasoningEffort;
  webSearchEnabled: boolean;
  count: Count;
  multimode: boolean;
  multimodeMaxImages: Count;
  multimodeSequences: Record<string, MultimodeSequenceState>;
  multimodeAbortControllers: Record<string, AbortController>;
  multimodePreviewFlightId: string | null;
  promptMode: "auto" | "direct";
  prompt: string;
  posePresets: PosePreset[];
  poseVarOpen: boolean;
  togglePoseVarOpen: () => void;
  updatePosePreset: (id: string, patch: Partial<Pick<PosePreset, "title" | "body">>) => void;
  resetPosePresets: () => void;
  generatePoseVariants: () => Promise<void>;
  editSourceImage: string | null;
  referenceImages: string[];
  canvasReferenceImage: string | null;
  addReferences: (files: File[]) => Promise<void>;
  addReferenceDataUrl: (dataUrl: string) => void;
  setEditSourceFromItem: (item: GenerateItem) => Promise<void>;
  clearEditSource: () => void;
  removeReference: (index: number) => void;
  clearReferences: () => void;
  useCurrentAsReference: () => Promise<void>;
  useImageAsReference: (item: GenerateItem) => Promise<void>;
  attachCanvasVersionReference: (item: GenerateItem) => Promise<void>;
  activeGenerations: number;
  unseenGeneratedCount: number;
  inFlight: PersistedInFlight[];
  failureLogs: GenerationFailureLog[];
  failureLogOpen: boolean;
  openFailureLog: () => void;
  closeFailureLog: () => void;
  clearFailureLogs: () => void;
  recordFailureLog: (log: GenerationFailureLog) => void;
  startInFlightPolling: () => void;
  reconcileInflight: () => Promise<void>;
  syncFromStorage: () => void;
  currentImage: GenerateItem | null;
  applyMergedCanvasImage: (item: GenerateItem) => void;
  addGeneratedHistoryItem: (item: GenerateItem) => Promise<void>;
  history: GenerateItem[];
  trashPending: TrashPendingState;
  toast: ToastState;
  customSizeConfirm: CustomSizeConfirmState;
  metadataRestore: MetadataRestoreState;
  readDroppedImageMetadata: (file: File) => Promise<boolean>;
  applyMetadataRestore: () => void;
  cancelMetadataRestore: () => void;
  addMetadataRestoreAsReference: () => void;
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  composeSheetOpen: boolean;
  openComposeSheet: () => void;
  closeComposeSheet: () => void;
  galleryOpen: boolean;
  openGallery: () => void;
  closeGallery: () => void;

  settingsOpen: boolean;
  activeSettingsSection: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setActiveSettingsSection: (section: SettingsSection) => void;


  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  themeFamily: ThemeFamily;
  historyStripLayout: HistoryStripLayout;
  setTheme: (theme: ThemePreference) => void;
  setThemeFamily: (family: ThemeFamily) => void;
  setHistoryStripLayout: (layout: HistoryStripLayout) => void;
  syncThemeFromStorage: () => void;
  syncThemeFamilyFromStorage: () => void;
  refreshResolvedTheme: () => void;

  locale: Locale;
  setLocale: (l: Locale) => void;

  setProvider: (p: Provider) => void;
  setQuality: (q: Quality) => void;
  setSizePreset: (s: SizePreset) => void;
  setCustomSize: (w: number, h: number) => void;
  setFormat: (f: Format) => void;
  setModeration: (m: Moderation) => void;
  setImageModel: (m: ImageModel) => void;
  setReasoningEffort: (e: ReasoningEffort) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setCount: (c: Count) => void;
  setMultimode: (enabled: boolean) => void;
  setMultimodeMaxImages: (c: Count) => void;
  generateMultimode: (sizeOverride?: string) => Promise<void>;
  cancelMultimode: () => void;
  setPromptMode: (m: "auto" | "direct") => void;
  setPrompt: (p: string) => void;
  insertedPrompts: InsertedPrompt[];
  insertPromptToComposer: (prompt: InsertedPrompt) => void;
  removeInsertedPromptFromComposer: (id: string) => void;
  clearInsertedPrompts: () => void;
  selectHistory: (item: GenerateItem) => void;
  hideCurrentImage: () => void;
  markGeneratedResultsSeen: () => void;
  selectHistoryShortcutTarget: (action: GalleryShortcutAction) => void;
  trashHistoryItem: (item: GenerateItem) => Promise<void>;
  restorePendingTrash: () => Promise<void>;
  clearPendingTrash: () => void;
  permanentlyDeleteHistoryItemByClick: (item: GenerateItem) => Promise<void>;
  permanentlyDeleteHistoryItemByShortcut: (item: GenerateItem) => Promise<void>;
  removeFromHistory: (filename: string) => void;
  addHistoryItem: (item: GenerateItem) => void;
  importLocalImageToHistory: (file: File) => Promise<GenerateItem | null>;
  generate: () => Promise<void>;
  runGenerate: (sizeOverride?: string) => Promise<void>;
  confirmCustomSizeAdjustment: () => Promise<void>;
  cancelCustomSizeAdjustment: () => void;
  hydrateHistory: () => void;
  showToast: (message: string, error?: boolean) => void;
  errorCard: {
    code: ImaErrorCode;
    fallbackMessage?: string;
    id: number;
  } | null;
  showErrorCard: (
    code: ImaErrorCode,
    params?: { fallbackMessage?: string },
  ) => void;
  dismissErrorCard: () => void;
  getResolvedSize: () => string;

  // Prompt Library (0.23)
  promptLibraryOpen: boolean;
  togglePromptLibrary: () => void;
  promptLibrary: {
    prompts: import("../lib/api").PromptItem[];
    folders: import("../lib/api").PromptFolder[];
  };
  promptLibraryLoading: boolean;
  loadPromptLibrary: () => Promise<void>;
  savePromptToLibrary: (payload: {
    name?: string;
    text: string;
    tags?: string[];
    folderId?: string;
    mode?: "auto" | "direct";
  }) => Promise<void>;
  updatePromptInLibrary: (
    id: string,
    payload: Partial<{
      name: string;
      text: string;
      tags: string[];
      folderId: string;
      mode: "auto" | "direct";
    }>,
  ) => Promise<void>;
  deletePromptFromLibrary: (id: string) => Promise<void>;
  togglePromptFavorite: (id: string) => Promise<void>;
  importPromptsToLibrary: (files: File[]) => Promise<void>;
  galleryFavorites: Set<string>;
  toggleGalleryFavorite: (filename: string) => Promise<void>;
  browserId: string;

  // Canvas Mode (0.24)
  canvasOpen: boolean;
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
  canvasExportBackground: CanvasExportBackground;
  canvasExportMatteColor: HexColor;
  openCanvas: () => void;
  closeCanvas: () => void;
  setCanvasZoom: (zoom: number) => void;
  resetCanvasZoom: () => void;
  setCanvasPan: (x: number, y: number) => void;
  resetCanvasPan: () => void;
  setCanvasExportBackground: (mode: CanvasExportBackground) => void;
  setCanvasExportMatteColor: (color: HexColor) => void;
};

function formatSize(w: number, h: number): string {
  return `${w}x${h}`;
}

function normalizeCount(value: number): Count {
  return Math.min(10, Math.max(1, Math.trunc(value || 1)));
}

const SIZE_PRESET_VALUES = new Set<SizePreset>([
  "auto",
  "2048x1152",
  "1872x1248",
  "1248x1872",
  "1152x2048",
  "1536x1536",
  "3840x2160",
  "3520x2352",
  "2352x3520",
  "2160x3840",
  "2880x2880",
]);

function parseMetadataSize(size?: string | null): {
  preset?: SizePreset;
  w?: number;
  h?: number;
} {
  if (typeof size !== "string") return {};
  if (SIZE_PRESET_VALUES.has(size as SizePreset))
    return { preset: size as SizePreset };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return {};
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return {};
  return { preset: "custom", w, h };
}

function isQuality(value: unknown): value is Quality {
  return value === "low" || value === "medium" || value === "high";
}

function isFormat(value: unknown): value is Format {
  return value === "png" || value === "jpeg" || value === "webp";
}

function isModeration(value: unknown): value is Moderation {
  return value === "low" || value === "auto";
}

function isProvider(value: unknown): value is Provider {
  return value === "oauth" || value === "api";
}

function isPromptMode(value: unknown): value is "auto" | "direct" {
  return value === "auto" || value === "direct";
}

function isSizePreset(value: unknown): value is SizePreset {
  return (
    typeof value === "string" && SIZE_PRESET_VALUES.has(value as SizePreset)
  );
}

function isInsertedPromptArray(value: unknown): value is InsertedPrompt[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.text === "string",
    )
  );
}

type GenerationDefaults = Partial<{
  provider: Provider;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
  count: Count;
  multimode: boolean;
  multimodeMaxImages: Count;
  promptMode: "auto" | "direct";
  prompt: string;
  insertedPrompts: InsertedPrompt[];
}>;

function loadGenerationDefaults(): GenerationDefaults {
  try {
    const raw = localStorage.getItem(GENERATION_DEFAULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: GenerationDefaults = {};
    if (isProvider(parsed.provider)) out.provider = parsed.provider;
    if (isQuality(parsed.quality)) out.quality = parsed.quality;
    if (isSizePreset(parsed.sizePreset)) out.sizePreset = parsed.sizePreset;
    if (typeof parsed.customW === "number" && Number.isFinite(parsed.customW)) {
      out.customW = parseRequestedCustomSide(parsed.customW, 1920);
    }
    if (typeof parsed.customH === "number" && Number.isFinite(parsed.customH)) {
      out.customH = parseRequestedCustomSide(parsed.customH, 1088);
    }
    if (isFormat(parsed.format)) out.format = parsed.format;
    if (isModeration(parsed.moderation)) out.moderation = parsed.moderation;
    if (typeof parsed.count === "number")
      out.count = normalizeCount(parsed.count);
    if (typeof parsed.multimode === "boolean") out.multimode = parsed.multimode;
    if (typeof parsed.multimodeMaxImages === "number") {
      out.multimodeMaxImages = normalizeCount(parsed.multimodeMaxImages);
    }
    if (isPromptMode(parsed.promptMode)) out.promptMode = parsed.promptMode;
    if (typeof parsed.prompt === "string") out.prompt = parsed.prompt;
    if (isInsertedPromptArray(parsed.insertedPrompts)) {
      out.insertedPrompts = parsed.insertedPrompts;
    }
    return out;
  } catch {
    return {};
  }
}

function saveGenerationDefaultsPatch(patch: GenerationDefaults): void {
  try {
    const current = loadGenerationDefaults();
    localStorage.setItem(
      GENERATION_DEFAULTS_STORAGE_KEY,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {}
}

function applyMetadataToState(
  state: AppState,
  metadata: EmbeddedGenerationMetadata,
): Partial<AppState> {
  const patch: Partial<AppState> = {};
  const prompt = metadata.userPrompt || metadata.prompt;
  if (typeof prompt === "string") patch.prompt = prompt;
  if (isQuality(metadata.quality)) patch.quality = metadata.quality;
  if (isFormat(metadata.format)) patch.format = metadata.format;
  if (isModeration(metadata.moderation)) patch.moderation = metadata.moderation;
  if (metadata.promptMode === "auto" || metadata.promptMode === "direct") {
    patch.promptMode = metadata.promptMode;
  }
  if (metadata.model && isImageModel(metadata.model)) {
    patch.imageModel = metadata.model;
  }
  const size = parseMetadataSize(metadata.size);
  if (size.preset) patch.sizePreset = size.preset;
  if (size.preset === "custom" && size.w && size.h) {
    patch.customW = parseRequestedCustomSide(size.w, state.customW);
    patch.customH = parseRequestedCustomSide(size.h, state.customH);
  }
  return patch;
}

function getCustomSizeConfirmation(
  state: AppState,
  continuation: NonNullable<CustomSizeConfirmState>["continuation"],
): CustomSizeConfirmState {
  if (state.sizePreset !== "custom") return null;
  const result = normalizeCustomSizePairDetailed(
    state.customW,
    state.customH,
    state.customW,
    state.customH,
  );
  if (!result.adjusted) return null;
  return {
    requestedW: result.requestedW,
    requestedH: result.requestedH,
    adjustedW: result.w,
    adjustedH: result.h,
    reasons: result.reasons,
    continuation,
  };
}

const storedGenerationDefaults = loadGenerationDefaults();
const initialPromptMode = storedGenerationDefaults.promptMode ?? "direct";
const initialWebSearchEnabled =
  initialPromptMode === "direct" ? false : loadWebSearchEnabled();

export const useAppStore = create<AppState>((set, get) => ({
  provider: storedGenerationDefaults.provider ?? "oauth",
  quality: "high",
  sizePreset: storedGenerationDefaults.sizePreset ?? "1536x1536",
  customW: storedGenerationDefaults.customW ?? 1920,
  customH: storedGenerationDefaults.customH ?? 1088,
  format: storedGenerationDefaults.format ?? "png",
  moderation: storedGenerationDefaults.moderation ?? "low",
  count: storedGenerationDefaults.count ?? 1,
  multimode: storedGenerationDefaults.multimode ?? false,
  multimodeMaxImages: storedGenerationDefaults.multimodeMaxImages ?? 4,
  multimodeSequences: {},
  multimodeAbortControllers: {},
  multimodePreviewFlightId: null,
  promptMode: initialPromptMode,
  prompt: storedGenerationDefaults.prompt ?? "",
  posePresets: loadPosePresets(),
  poseVarOpen: false,
  editSourceImage: null,
  insertedPrompts: storedGenerationDefaults.insertedPrompts ?? [],
  referenceImages: [],
  canvasReferenceImage: null,

  // Prompt Library state (0.23)
  promptLibraryOpen: false,
  promptLibrary: { prompts: [], folders: [] },
  promptLibraryLoading: false,
  galleryFavorites: new Set(),
  browserId: getBrowserId(),

  // Canvas Mode state (0.24)
  canvasOpen: false,
  canvasZoom: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  canvasExportBackground: loadCanvasExportBackground().mode,
  canvasExportMatteColor: loadCanvasExportBackground().matteColor,

  addReferences: async (files) => {
    const allowed = MAX_REFERENCE_IMAGES - get().referenceImages.length;
    const toAdd = files.slice(0, Math.max(0, allowed));
    const heicSkipped = toAdd.filter(isHeic);
    const usable = toAdd.filter((f) => !isHeic(f));
    const results = await Promise.all(
      usable.map(async (f) => {
        try {
          return await compressToBase64(f, {
            preserveTransparency: hasAlphaChannel(f),
          });
        } catch (err) {
          console.warn("[addReferences] compress failed", err);
          return null;
        }
      }),
    );
    const valid = results.filter((x): x is string => !!x);
    set((s) => ({
      referenceImages: [...s.referenceImages, ...valid].slice(
        0,
        MAX_REFERENCE_IMAGES,
      ),
    }));
    if (heicSkipped.length > 0) {
      get().showToast(t("toast.refHeicUnsupported"), true);
    }
    const failedCount = usable.length - valid.length;
    if (failedCount > 0) {
      get().showToast(t("toast.refTooLarge"), true);
    }
    if (files.length > allowed) {
      get().showToast(t("toast.refLimitExceeded"), true);
    }
  },
  addReferenceDataUrl: (dataUrl) => {
    set((s) =>
      s.referenceImages.length >= MAX_REFERENCE_IMAGES
        ? s
        : { referenceImages: [...s.referenceImages, dataUrl] },
    );
  },
  setEditSourceFromItem: async (item) => {
    let dataUrl: string;
    try {
      dataUrl = await compressReferenceSource(
        item.image,
        item.filename || "edit-source.png",
      );
    } catch {
      get().showToast(t("toast.currentImageLoadFailed"), true);
      return;
    }
    set({ editSourceImage: dataUrl });
    get().showToast(t("toast.editSourceSet"));
  },
  clearEditSource: () => set({ editSourceImage: null }),
  metadataRestore: null,
  readDroppedImageMetadata: async (file) => {
    if (!file.type.startsWith("image/")) return false;
    let dataUrl = "";
    try {
      dataUrl = await readFileAsDataURL(file);
      const result = await readImageMetadata({ filename: file.name, dataUrl });
      if (!result.metadata) return false;
      set({
        metadataRestore: {
          filename: file.name,
          image: dataUrl,
          metadata: result.metadata,
          source: result.source ?? "xmp",
        },
      });
      return true;
    } catch {
      get().showToast(t("metadata.readFailed"), true);
      return false;
    }
  },
  applyMetadataRestore: () => {
    const pending = get().metadataRestore;
    if (!pending) return;
    const patch = applyMetadataToState(get(), pending.metadata);
    if (patch.imageModel) saveImageModel(patch.imageModel);
    set({ ...patch, metadataRestore: null });
    get().showToast(t("metadata.applied"));
  },
  cancelMetadataRestore: () => set({ metadataRestore: null }),
  addMetadataRestoreAsReference: () => {
    const pending = get().metadataRestore;
    if (!pending) return;
    get().addReferenceDataUrl(pending.image);
    set({ metadataRestore: null });
  },
  removeReference: (index) => {
    set((s) => ({
      referenceImages: s.referenceImages.filter((_, i) => i !== index),
      canvasReferenceImage:
        s.referenceImages[index] === s.canvasReferenceImage
          ? null
          : s.canvasReferenceImage,
    }));
  },
  clearReferences: () =>
    set({ referenceImages: [], canvasReferenceImage: null }),
  attachCanvasVersionReference: async (item) => {
    let dataUrl: string;
    try {
      dataUrl = await compressReferenceSource(
        item.image,
        item.filename || "canvas-version-reference.png",
      );
    } catch {
      get().showToast(t("toast.currentImageLoadFailed"), true);
      throw new Error("canvas_reference_attach_failed");
    }
    set((s) => {
      const withoutPrevious = s.canvasReferenceImage
        ? s.referenceImages.filter((ref) => ref !== s.canvasReferenceImage)
        : s.referenceImages;
      const withoutDuplicate = withoutPrevious.filter((ref) => ref !== dataUrl);
      return {
        canvasReferenceImage: dataUrl,
        referenceImages: [dataUrl, ...withoutDuplicate].slice(
          0,
          MAX_REFERENCE_IMAGES,
        ),
      };
    });
    get().showToast(t("canvas.version.usingAsReference"));
  },
  useCurrentAsReference: async () => {
    const cur = get().currentImage;
    if (!cur) {
      get().showToast(t("toast.noCurrentImageForRef"), true);
      return;
    }
    if (get().referenceImages.length >= MAX_REFERENCE_IMAGES) {
      get().showToast(t("toast.refSlotFull"), true);
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await compressReferenceSource(
        cur.image,
        cur.filename || "current-reference.png",
      );
    } catch {
      get().showToast(t("toast.currentImageLoadFailed"), true);
      return;
    }
    set((s) => ({
      referenceImages: [...s.referenceImages, dataUrl].slice(
        0,
        MAX_REFERENCE_IMAGES,
      ),
    }));
    get().showToast(t("toast.addedCurrentAsRef"));
  },
  useImageAsReference: async (item) => {
    if (get().referenceImages.length >= MAX_REFERENCE_IMAGES) {
      get().showToast(t("toast.refSlotFull"), true);
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await compressReferenceSource(
        item.image,
        item.filename || "canvas-reference.png",
      );
    } catch {
      get().showToast(t("toast.currentImageLoadFailed"), true);
      return;
    }
    set((s) => ({
      referenceImages: [...s.referenceImages, dataUrl].slice(
        0,
        MAX_REFERENCE_IMAGES,
      ),
    }));
    get().showToast(t("toast.addedCurrentAsRef"));
  },
  activeGenerations: 0,
  unseenGeneratedCount: 0,
  inFlight: [],
  failureLogs: loadFailureLogs(),
  failureLogOpen: false,
  openFailureLog: () => set({ failureLogOpen: true }),
  closeFailureLog: () => set({ failureLogOpen: false }),
  clearFailureLogs: () => {
    const inFlight = get().inFlight.filter(
      (f) => !isStaleInflightRecord(f),
    );
    saveInFlight(inFlight);
    saveFailureLogs([]);
    set({ failureLogs: [], inFlight, activeGenerations: countActiveInFlight(inFlight) });
    void clearInflightTerminalJobs();
  },
  recordFailureLog: (log) => {
    set((s) => {
      const next = [
        log,
        ...s.failureLogs.filter((existing) => existing.id !== log.id),
      ].slice(0, MAX_FAILURE_LOGS);
      saveFailureLogs(next);
      return { failureLogs: next };
    });
  },
  startInFlightPolling: () => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      __ima2InflightTimer?: number;
      __ima2HistoryPollAt?: number;
    };
    if (w.__ima2InflightTimer) return;
    const tick = async () => {
      const cur = pruneTerminalInFlight(get().inFlight);
      if (cur.length !== get().inFlight.length) {
        saveInFlight(cur);
        set({
          inFlight: cur,
          activeGenerations: countActiveInFlight(cur),
        });
      }
      if (cur.length === 0) {
        if (w.__ima2InflightTimer) {
          clearInterval(w.__ima2InflightTimer);
          w.__ima2InflightTimer = undefined;
        }
        return;
      }
      const hasActiveInFlight = countActiveInFlight(cur) > 0;
      let scopedActiveServerIds = new Set<string>();
      // Merge server-side phase info so the spinner label reflects real progress
      if (hasActiveInFlight) try {
        const inflightKind = "classic";
        const inflightSessionId = undefined;
        const { jobs, terminalJobs = [] } = await getInflight({
          kind: inflightKind,
          sessionId: inflightSessionId,
          includeTerminal: true,
        });
        scopedActiveServerIds = new Set(jobs.map((j) => j.requestId));
        const byId = new Map(jobs.map((j) => [j.requestId, j] as const));
        const terminalById = new Map(
          (terminalJobs as ServerTerminalJob[]).map(
            (j) => [j.requestId, j] as const,
          ),
        );
        let changed = false;
        const nextInflight: typeof cur = [];
        for (const f of get().inFlight) {
          // Out-of-scope entries (different kind/session) must not be dropped
          // based on this tick's byId — the server wasn't asked about them.
          const fKind = f.kind ?? "classic";
          const matchesScope = fKind === inflightKind;
          if (!matchesScope) {
            nextInflight.push(f);
            continue;
          }
          const terminal = terminalById.get(f.id);
          if (terminal) {
            changed = true;
            const terminalFlight = terminalToPersistedInFlight(f, terminal);
            if (terminal.status === "error") {
              get().recordFailureLog({
                id: terminalFlight.id,
                prompt: terminalFlight.prompt,
                startedAt: terminalFlight.startedAt,
                finishedAt: terminalFlight.finishedAt ?? Date.now(),
                phase: terminalFlight.phase,
                errorCode: terminalFlight.errorCode,
                errorMessage: terminalFlight.errorMessage,
                errorDetails: terminalFlight.errorDetails,
                httpStatus: terminalFlight.httpStatus,
                durationMs: terminalFlight.durationMs,
                kind: terminalFlight.kind,
                meta: terminalFlight.meta,
              });
            }
            nextInflight.push(terminalFlight);
            continue;
          }
          const p = byId.get(f.id);
          if (p) {
            const serverJob = toPersistedInFlightJob(p);
            const nextJob = {
              ...f,
              phase: serverJob.phase,
              sessionId: serverJob.sessionId,
              parentNodeId: serverJob.parentNodeId,
              clientNodeId: serverJob.clientNodeId,
              kind: serverJob.kind,
            };
            if (
              nextJob.phase !== f.phase ||
              nextJob.sessionId !== f.sessionId ||
              nextJob.parentNodeId !== f.parentNodeId ||
              nextJob.clientNodeId !== f.clientNodeId ||
              nextJob.kind !== f.kind
            ) {
              changed = true;
            }
            nextInflight.push(nextJob);
          } else {
            const now = Date.now();
            const isRecentLocal =
              now - f.startedAt < SERVER_MISSING_INFLIGHT_GRACE_MS;
            if (isRecentLocal || isClientGenerationPending(f.id)) {
              nextInflight.push(f);
            } else {
              // This is a local/server reconciliation miss, not a generation
              // failure. Drop it from the queue instead of replaying a
              // persistent error log every time localStorage is rehydrated.
              changed = true;
            }
          }
        }
        // Re-add active jobs that only the server knows about. This covers
        // reload/abort races where localStorage lost requestIds while the
        // backend kept streaming.
        const nextIds = new Set(nextInflight.map((f) => f.id));
        for (const j of jobs) {
          if (!nextIds.has(j.requestId)) {
            nextInflight.push(toPersistedInFlightJob(j));
            changed = true;
          }
        }
        if (changed) {
          saveInFlight(nextInflight);
          set({
            inFlight: nextInflight,
            activeGenerations: countActiveInFlight(nextInflight),
          });
        }
      } catch {}
      const nowForHistory = Date.now();
      if (nowForHistory - (w.__ima2HistoryPollAt ?? 0) >= INFLIGHT_HISTORY_POLL_MS) {
        w.__ima2HistoryPollAt = nowForHistory;
        try {
          const lastKnown = get().history.reduce(
            (max, it) =>
              it.createdAt && it.createdAt > max ? it.createdAt : max,
            0,
          );
          const { items } = await getHistory({
            limit: HISTORY_LIMIT,
            since: lastKnown,
          });
          const arr: GenerateItem[] = items.map(mapHistoryItem);
          const existing = get().history;
          const existingFilenames = new Set(existing.map((e) => e.filename));
          const fresh = arr.filter(
            (a) =>
              !pendingDeletedFilenames.has(a.filename ?? "") &&
              !existingFilenames.has(a.filename),
          );
          if (fresh.length > 0) {
            set((s) => {
              const nextCurrent = s.currentImage ?? fresh[0];
              if (!s.currentImage && fresh[0]?.filename) {
                saveSelectedFilename(fresh[0].filename);
              }
              const historyFilenames = new Set(s.history.map((h) => h.filename));
              const reallyFresh = fresh.filter(
                (a) =>
                  !pendingDeletedFilenames.has(a.filename ?? "") &&
                  !historyFilenames.has(a.filename),
              );
              return {
                history: [...reallyFresh, ...s.history].slice(0, HISTORY_LIMIT),
                currentImage: nextCurrent,
              };
            });
          }
        } catch {}
      }
      try {
        // Prune strategy: TTL-based only. Do not attempt to correlate
        // history items with inFlight entries — backend ordering may differ
        // from local generation order under concurrency. Matching by prompt
        // is also unreliable when the same prompt is queued twice.
        const now = Date.now();
        const remaining = get().inFlight.filter(
          (f) =>
            (f.terminal && isInFlightVisible(f, now)) ||
            scopedActiveServerIds.has(f.id) ||
            isClientGenerationPending(f.id) ||
            now - f.startedAt < INFLIGHT_TTL_MS,
        );
        if (remaining.length !== get().inFlight.length) {
          saveInFlight(remaining);
          set({
            inFlight: remaining,
            activeGenerations: countActiveInFlight(remaining),
          });
        }
      } catch {}
    };
    w.__ima2InflightTimer = window.setInterval(tick, 1500) as unknown as number;
  },
  reconcileInflight: async () => {
    try {
      const inflightKind = "classic";
      const inflightSessionId = undefined;
      const { jobs, terminalJobs = [] } = await getInflight({
        kind: inflightKind,
        sessionId: inflightSessionId,
        includeTerminal: true,
      });
      const serverById = new Map(jobs.map((j) => [j.requestId, j] as const));
      const terminalById = new Map(
        (terminalJobs as ServerTerminalJob[]).map(
          (j) => [j.requestId, j] as const,
        ),
      );
      const now = Date.now();
      const currentLocal = get().inFlight;
      const local = currentLocal.length > 0 ? currentLocal : loadInFlight();
      // Keep local entries that are either still known to the server,
      // or started very recently (<10s — request may be in-flight before
      // /api/inflight registered). Keep out-of-scope entries because this
      // request only asked the server about the current mode/session.
      const merged = local.flatMap((f) => {
        const serverJob = serverById.get(f.id);
        if (serverJob) {
          const restored = toPersistedInFlightJob(serverJob);
          return [{ ...f, ...restored, prompt: f.prompt || restored.prompt }];
        }
        const fKind = f.kind ?? "classic";
        const matchesScope = fKind === inflightKind;
        if (!matchesScope) return [f];
        const terminal = terminalById.get(f.id);
        if (terminal) {
          const terminalFlight = terminalToPersistedInFlight(f, terminal);
          if (terminal.status === "error") {
            get().recordFailureLog({
              id: terminalFlight.id,
              prompt: terminalFlight.prompt,
              startedAt: terminalFlight.startedAt,
              finishedAt: terminalFlight.finishedAt ?? Date.now(),
              phase: terminalFlight.phase,
              errorCode: terminalFlight.errorCode,
              errorMessage: terminalFlight.errorMessage,
              errorDetails: terminalFlight.errorDetails,
              httpStatus: terminalFlight.httpStatus,
              durationMs: terminalFlight.durationMs,
              kind: terminalFlight.kind,
              meta: terminalFlight.meta,
            });
          }
          return [terminalFlight];
        }
        return now - f.startedAt < SERVER_MISSING_INFLIGHT_GRACE_MS ||
          isClientGenerationPending(f.id)
          ? [f]
          : [];
      });
      // Bring in server-only jobs (started from another tab / process)
      const localIds = new Set(merged.map((f) => f.id));
      for (const j of jobs) {
        if (!localIds.has(j.requestId)) {
          merged.push(toPersistedInFlightJob(j));
        }
      }
      const activeServerIds = new Set(jobs.map((j) => j.requestId));
      const visible = merged.filter(
        (f) =>
          activeServerIds.has(f.id) ||
          (f.terminal && isInFlightVisible(f, now)) ||
          (!f.terminal &&
            (now - f.startedAt < SERVER_MISSING_INFLIGHT_GRACE_MS ||
              isClientGenerationPending(f.id))),
      );
      saveInFlight(visible);
      set({ inFlight: visible, activeGenerations: countActiveInFlight(visible) });
      if (visible.length > 0) get().startInFlightPolling();
    } catch {
      // Silent — endpoint may not exist on older servers.
    }
  },
  syncFromStorage: () => {
    // Triggered by `storage` events (another tab changed localStorage).
    const nextInflight = pruneRecoverableInFlight(loadInFlight());
    const nextFailureLogs = loadFailureLogs();
    const nextSelected = loadSelectedFilename();
    const nextImageModel = loadImageModel();
    set((s) => {
      const matched = nextSelected
        ? (s.history.find((h) => h.filename === nextSelected) ?? null)
        : null;
      const normalized = matched
        ? resolveVisibleShortcutCurrent(s.history, matched)
        : null;
      const visibleFallback = getVisibleGalleryItems(s.history)[0] ?? null;
      const currentImage = s.currentImage?.canvasVersion
        ? (resolveVisibleShortcutCurrent(s.history, s.currentImage) ??
          visibleFallback)
        : s.currentImage;
      return {
        inFlight: nextInflight,
        failureLogs: nextFailureLogs,
        activeGenerations: countActiveInFlight(nextInflight),
        imageModel: nextImageModel,
        currentImage:
          nextSelected && currentImage?.filename !== nextSelected
            ? (normalized ?? currentImage)
            : currentImage,
      };
    });
    if (nextInflight.length > 0) get().startInFlightPolling();
  },
  currentImage: null,
  applyMergedCanvasImage: (item) => {
    set((s) => {
      if (!item.filename) return { history: s.history };
      const filtered = s.history.filter((h) => h.filename !== item.filename);
      return {
        history: [item, ...filtered].slice(0, HISTORY_LIMIT),
      };
    });
  },
  addGeneratedHistoryItem: async (item) => {
    get().addHistoryItem(item);
    set({ unseenGeneratedCount: get().unseenGeneratedCount + 1 });
  },
  history: [],
  trashPending: null,
  toast: null,
  customSizeConfirm: null,
  errorCard: null,
  rightPanelOpen: loadRightPanelOpen(),
  toggleRightPanel: () =>
    set((s) => {
      const next = !s.rightPanelOpen;
      try {
        localStorage.setItem("ima2.rightPanelOpen", JSON.stringify(next));
      } catch {}
      return { rightPanelOpen: next };
    }),
  composeSheetOpen: false,
  openComposeSheet: () => set({ composeSheetOpen: true }),
  closeComposeSheet: () => set({ composeSheetOpen: false }),
  galleryOpen: false,
  openGallery: () => set({ galleryOpen: true }),
  closeGallery: () => set({ galleryOpen: false }),

  imageModel: loadImageModel(),
  reasoningEffort: loadReasoningEffort(),
  webSearchEnabled: initialWebSearchEnabled,

  settingsOpen: false,
  activeSettingsSection: "account",
  openSettings: (section = "account") =>
    set({ settingsOpen: true, activeSettingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () =>
    set((s) => ({
      settingsOpen: !s.settingsOpen,
      activeSettingsSection: s.settingsOpen
        ? s.activeSettingsSection
        : "account",
    })),
  setActiveSettingsSection: (section) =>
    set({ activeSettingsSection: section }),

  theme: loadThemePreference(),
  resolvedTheme: resolveThemePreference(loadThemePreference()),
  themeFamily: loadThemeFamily(),
  historyStripLayout: loadHistoryStripLayout(),
  setTheme: (theme) => {
    try {
      localStorage.setItem("ima2:theme", theme);
    } catch {}
    set({ theme, resolvedTheme: resolveThemePreference(theme) });
  },
  setThemeFamily: (family) => {
    try {
      localStorage.setItem("ima2:themeFamily", family);
    } catch {}
    set({ themeFamily: family });
  },
  setHistoryStripLayout: (layout) => {
    try {
      localStorage.setItem("ima2.historyStripLayout", layout);
    } catch {}
    set({ historyStripLayout: layout });
  },
  syncThemeFromStorage: () => {
    const theme = loadThemePreference();
    set({ theme, resolvedTheme: resolveThemePreference(theme) });
  },
  syncThemeFamilyFromStorage: () => {
    set({ themeFamily: loadThemeFamily() });
  },
  refreshResolvedTheme: () => {
    set((s) => ({ resolvedTheme: resolveThemePreference(s.theme) }));
  },

  locale: loadLocale(),
  setLocale: (l) => {
    saveLocale(l);
    set({ locale: l });
  },

  setProvider: (provider) => {
    saveGenerationDefaultsPatch({ provider });
    set({ provider });
  },
  setQuality: (quality) => {
    saveGenerationDefaultsPatch({ quality });
    set({ quality });
  },
  setSizePreset: (sizePreset) => {
    saveGenerationDefaultsPatch({ sizePreset });
    set({ sizePreset });
  },
  setCustomSize: (w, h) =>
    set((state) => {
      const customW = parseRequestedCustomSide(w, state.customW);
      const customH = parseRequestedCustomSide(h, state.customH);
      saveGenerationDefaultsPatch({ customW, customH });
      return { customW, customH };
    }),
  setFormat: (format) => {
    saveGenerationDefaultsPatch({ format });
    set({ format });
  },
  setModeration: (moderation) => {
    saveGenerationDefaultsPatch({ moderation });
    set({ moderation });
  },
  setImageModel: (imageModel) => {
    saveImageModel(imageModel);
    set({ imageModel });
  },
  setReasoningEffort: (reasoningEffort) => {
    saveReasoningEffort(reasoningEffort);
    set({ reasoningEffort });
  },
  setWebSearchEnabled: (webSearchEnabled) => {
    saveWebSearchEnabled(webSearchEnabled);
    if (webSearchEnabled) {
      saveGenerationDefaultsPatch({ promptMode: "auto" });
      set({ webSearchEnabled, promptMode: "auto" });
      return;
    }
    set({ webSearchEnabled });
  },
  setCount: (count) => {
    const next = normalizeCount(count);
    saveGenerationDefaultsPatch({ count: next });
    set({ count: next });
  },
  setMultimode: (enabled) => {
    saveGenerationDefaultsPatch({ multimode: enabled });
    const s = get();
    set({
      multimode: enabled,
      multimodeSequences: enabled ? s.multimodeSequences : {},
      multimodePreviewFlightId: enabled ? s.multimodePreviewFlightId : null,
    });
  },
  setMultimodeMaxImages: (count) => {
    const next = normalizeCount(count);
    saveGenerationDefaultsPatch({ multimodeMaxImages: next });
    set({ multimodeMaxImages: next });
  },
  setPromptMode: (promptMode) => {
    saveGenerationDefaultsPatch({ promptMode });
    if (promptMode === "direct") {
      saveWebSearchEnabled(false);
      set({ promptMode, webSearchEnabled: false });
      return;
    }
    set({ promptMode });
  },
  setPrompt: (prompt) => {
    saveGenerationDefaultsPatch({ prompt });
    set({ prompt });
  },
  togglePoseVarOpen: () => set((state) => ({ poseVarOpen: !state.poseVarOpen })),
  updatePosePreset: (id, patch) =>
    set((state) => {
      const posePresets = state.posePresets.map((preset) =>
        preset.id === id ? { ...preset, ...patch } : preset,
      );
      savePosePresets(posePresets);
      return { posePresets };
    }),
  resetPosePresets: () => {
    savePosePresets(DEFAULT_POSE_PRESETS);
    set({ posePresets: DEFAULT_POSE_PRESETS });
  },
  insertPromptToComposer: (prompt) =>
    set((state) => {
      const exists = state.insertedPrompts.some(
        (item) => item.id === prompt.id,
      );
      const insertedPrompts = exists
        ? state.insertedPrompts
        : [...state.insertedPrompts, prompt];
      saveGenerationDefaultsPatch({ insertedPrompts });
      return {
        insertedPrompts,
      };
    }),
  removeInsertedPromptFromComposer: (id) =>
    set((state) => {
      const insertedPrompts = state.insertedPrompts.filter(
        (prompt) => prompt.id !== id,
      );
      saveGenerationDefaultsPatch({ insertedPrompts });
      return { insertedPrompts };
    }),
  clearInsertedPrompts: () => {
    saveGenerationDefaultsPatch({ insertedPrompts: [] });
    set({ insertedPrompts: [] });
  },

  selectHistory: (item) => {
    const history = get().history;
    const target = item.canvasVersion
      ? (resolveVisibleShortcutCurrent(history, item) ??
        getVisibleGalleryItems(history)[0] ??
        null)
      : (resolveVisibleShortcutCurrent(history, item) ?? item);
    saveSelectedFilename(target?.filename ?? null);
    set({
      currentImage: target,
      unseenGeneratedCount: 0,
      multimodePreviewFlightId: null,
    });
  },
  hideCurrentImage: () => {
    saveSelectedFilename(null);
    set({
      currentImage: null,
      unseenGeneratedCount: 0,
      multimodePreviewFlightId: null,
    });
  },

  markGeneratedResultsSeen: () => set({ unseenGeneratedCount: 0 }),

  selectHistoryShortcutTarget: (action) => {
    const target = getShortcutTarget(get().history, get().currentImage, action);
    if (!target) return;
    get().selectHistory(target);
  },

  trashHistoryItem: async (item) => {
    const target = item.canvasVersion
      ? resolveVisibleShortcutCurrent(get().history, item)
      : item;
    if (!target || target.canvasVersion || !target.filename) {
      get().showToast(t("gallery.deleteFailed"), true);
      return;
    }
    const filename = target.filename;
    const current = get().currentImage;
    const visibleCurrent = current
      ? (resolveVisibleShortcutCurrent(get().history, current) ?? current)
      : null;
    const removingCurrent = visibleCurrent?.filename === filename;
    const replacement = removingCurrent
      ? getNeighborAfterRemoval(get().history, filename)
      : current;
    rememberPendingDeletedFilename(filename);
    set((s) => ({
      history: s.history.filter((h) => h.filename !== filename),
      currentImage: removingCurrent ? replacement : s.currentImage,
      trashPending: null,
    }));
    if (removingCurrent) saveSelectedFilename(replacement?.filename ?? null);
    try {
      await deleteHistoryItem(filename);
      get().showToast(t("gallery.movedToSystemTrash", { filename }));
    } catch (err) {
      pendingDeletedFilenames.delete(filename);
      set((s) => {
        const exists = s.history.some((h) => h.filename === filename);
        const history = exists ? s.history : [target, ...s.history].slice(0, HISTORY_LIMIT);
        return {
          history,
          currentImage: removingCurrent ? target : s.currentImage,
        };
      });
      if (removingCurrent) saveSelectedFilename(filename);
      console.error("[history] trash failed", err);
      get().showToast(t("gallery.deleteFailed"), true);
    }
  },

  restorePendingTrash: async () => {
    const pending = get().trashPending;
    if (!pending) return;
    try {
      await restoreHistoryItem(pending.filename, pending.trashId);
      get().addHistoryItem(pending.item);
      set({ trashPending: null });
    } catch (err) {
      console.error("[history] restore failed", err);
      get().showToast(t("gallery.restoreFailed"), true);
    }
  },

  clearPendingTrash: () => set({ trashPending: null }),

  permanentlyDeleteHistoryItemByClick: async (item) => {
    await get().permanentlyDeleteHistoryItemByShortcut(item);
  },

  permanentlyDeleteHistoryItemByShortcut: async (item) => {
    const target = item.canvasVersion
      ? resolveVisibleShortcutCurrent(get().history, item)
      : item;
    if (!target || target.canvasVersion || !target.filename) {
      get().showToast(t("gallery.deleteFailed"), true);
      return;
    }
    const filename = target.filename;
    const ok = window.confirm(t("result.permanentDeleteConfirm", { filename }));
    if (!ok) return;
    const current = get().currentImage;
    const visibleCurrent = current
      ? (resolveVisibleShortcutCurrent(get().history, current) ?? current)
      : null;
    const removingCurrent = visibleCurrent?.filename === filename;
    const replacement = removingCurrent
      ? getNeighborAfterRemoval(get().history, filename)
      : current;
    rememberPendingDeletedFilename(filename);
    set((s) => ({
      history: s.history.filter((h) => h.filename !== filename),
      currentImage: removingCurrent ? replacement : s.currentImage,
      trashPending:
        s.trashPending?.filename === filename ? null : s.trashPending,
    }));
    if (removingCurrent) saveSelectedFilename(replacement?.filename ?? null);
    try {
      await permanentlyDeleteHistoryItem(filename);
      get().showToast(t("gallery.permanentDeleted", { filename }));
    } catch (err) {
      pendingDeletedFilenames.delete(filename);
      set((s) => {
        const exists = s.history.some((h) => h.filename === filename);
        const history = exists ? s.history : [target, ...s.history].slice(0, HISTORY_LIMIT);
        return {
          history,
          currentImage: removingCurrent ? target : s.currentImage,
        };
      });
      if (removingCurrent) saveSelectedFilename(filename);
      console.error("[history] permanent delete failed", err);
      get().showToast(t("gallery.deleteFailed"), true);
    }
  },

  removeFromHistory: (filename) => {
    const s = get();
    const history = s.history.filter((h) => h.filename !== filename);
    const stillCurrent =
      s.currentImage && s.currentImage.filename === filename
        ? null
        : s.currentImage;
    set({ history, currentImage: stillCurrent });
    if (stillCurrent === null) saveSelectedFilename(null);
  },

  addHistoryItem: (item) => {
    const s = get();
    const exists = s.history.some(
      (h) => item.filename && h.filename === item.filename,
    );
    if (exists) return;
    const withDefaults: GenerateItem = {
      ...item,
      createdAt: item.createdAt || Date.now(),
    };
    set({ history: [withDefaults, ...s.history].slice(0, HISTORY_LIMIT) });
  },

  importLocalImageToHistory: async (file) => {
    if (!file.type || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
      get().showToast(t("toast.localImportInvalid"), true);
      return null;
    }
    try {
      const item = await importLocalImage(file);
      get().addHistoryItem(item);
      set({ currentImage: item, unseenGeneratedCount: 0 });
      if (item.filename) saveSelectedFilename(item.filename);
      get().showToast(t("toast.localImportSuccess"));
      return item;
    } catch {
      get().showToast(t("toast.localImportFailed"), true);
      return null;
    }
  },

  getResolvedSize: () => {
    const { sizePreset, customW, customH } = get();
    return sizePreset === "custom" ? `${customW}x${customH}` : sizePreset;
  },

  async generatePoseVariants() {
    const s = get();
    const basePrompt = composePrompt(s.prompt, s.insertedPrompts);
    if (!basePrompt) return;

    const presets = normalizePosePresets(s.posePresets).slice(0, 10);
    if (presets.length === 0) return;

    const size = s.getResolvedSize();
    const startedAt = Date.now();
    const variants = presets.map((preset, index) => ({
      preset,
      index,
      prompt: replacePoseSection(basePrompt, preset),
      requestId: `v_${startedAt}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    }));

    for (const variant of variants) clientGenerationPendingIds.add(variant.requestId);
    const nextInFlight: PersistedInFlight[] = [
      ...s.inFlight,
      ...variants.map((variant) => ({
        id: variant.requestId,
        prompt: variant.prompt,
        startedAt,
        phase: "local",
        kind: "classic" as const,
        meta: {
          kind: "classic",
          variant: "pose",
          posePresetId: variant.preset.id,
          posePresetTitle: variant.preset.title,
          retryAttempt: 0,
          maxRetryAttempts: 3,
        },
      })),
    ];
    saveInFlight(nextInFlight);
    set({
      activeGenerations: s.activeGenerations + variants.length,
      inFlight: nextInFlight,
    });
    get().startInFlightPolling();

    const markFlightTerminal = (
      requestId: string,
      patch: Pick<PersistedInFlight, "phase" | "terminal" | "finishedAt"> &
        Partial<
          Pick<
            PersistedInFlight,
            | "errorCode"
            | "errorMessage"
            | "errorDetails"
            | "httpStatus"
            | "durationMs"
            | "meta"
          >
        >,
    ) => {
      clientGenerationPendingIds.delete(requestId);
      const current = get().inFlight.find((f) => f.id === requestId);
      const terminalFlight = current ? { ...current, ...patch } : null;
      const next = get().inFlight.map((f) =>
        f.id === requestId && !f.terminal ? { ...f, ...patch } : f,
      );
      saveInFlight(next);
      set({
        inFlight: next,
        activeGenerations: countActiveInFlight(next),
      });
      if (terminalFlight?.phase === "error") {
        get().recordFailureLog({
          id: terminalFlight.id,
          prompt: terminalFlight.prompt,
          startedAt: terminalFlight.startedAt,
          finishedAt: terminalFlight.finishedAt ?? Date.now(),
          phase: terminalFlight.phase,
          errorCode: terminalFlight.errorCode,
          errorMessage: terminalFlight.errorMessage,
          errorDetails: terminalFlight.errorDetails,
          httpStatus: terminalFlight.httpStatus,
          durationMs: terminalFlight.durationMs,
          kind: terminalFlight.kind,
          meta: terminalFlight.meta,
        });
      }
    };

    const patchFlight = (
      requestId: string,
      patch: Partial<PersistedInFlight>,
    ) => {
      const next = get().inFlight.map((f) =>
        f.id === requestId && !f.terminal ? { ...f, ...patch } : f,
      );
      saveInFlight(next);
      set({ inFlight: next });
    };

    const commonPayloadBase = {
      quality: "high" as Quality,
      size,
      format: "png" as Format,
      moderation: "low" as Moderation,
      provider: s.provider,
      model: s.imageModel,
      reasoningEffort: s.reasoningEffort,
      webSearchEnabled: s.webSearchEnabled,
      mode: s.promptMode,
      ...(s.referenceImages.length
        ? { references: s.referenceImages.map(stripDataUrlPrefix) }
        : {}),
    };

    let generatedCount = 0;
    let latestElapsed = 0;

    await Promise.all(
      variants.map(async (variant) => {
        let lastErr: unknown = null;
        let lastDuration = 0;
        let attemptsUsed = 0;
        let lastRetryJitter = "none";
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          attemptsUsed = attempt;
          const attemptStartedAt = Date.now();
          const attemptRequestId =
            attempt === 1 ? variant.requestId : `${variant.requestId}_try${attempt}`;
          const jittered = jitterPoseSectionOrderForRetry(
            variant.prompt,
            attempt - 1,
          );
          lastRetryJitter = jittered.strategy;
          try {
            const res = await withGenerationPostSlot(async () => {
              patchFlight(variant.requestId, {
                phase: attempt === 1 ? "requesting" : `retrying-${attempt}`,
                meta: {
                  kind: "classic",
                  variant: "pose",
                  posePresetId: variant.preset.id,
                  posePresetTitle: variant.preset.title,
                  retryAttempt: attempt - 1,
                  maxRetryAttempts: 3,
                  upstreamRequestId: attemptRequestId,
                  retryJitter: jittered.strategy,
                },
              });
              return postGenerate({
                ...commonPayloadBase,
                prompt: jittered.prompt,
                displayPrompt: basePrompt,
                requestId: attemptRequestId,
                clientMeta: {
                  variant: "pose",
                  posePresetId: variant.preset.id,
                  posePresetTitle: variant.preset.title,
                  posePresetIndex: variant.index,
                  retryAttempt: attempt - 1,
                  maxRetryAttempts: 3,
                  parentRequestId: variant.requestId,
                  retryJitter: jittered.strategy,
                },
                n: 1,
              });
            });

            const item: GenerateItem = isMultiResponse(res)
              ? {
                  image: res.images[0].image,
                  filename: res.images[0].filename,
                  requestId: variant.requestId,
                  prompt: basePrompt,
                  userPrompt: basePrompt,
                  elapsed: res.elapsed,
                  provider: res.provider,
                  usage: res.usage,
                  quality: res.quality ?? "high",
                  size: res.size ?? size,
                  model: res.model ?? s.imageModel,
                }
              : {
                  image: res.image,
                  filename: res.filename,
                  requestId: variant.requestId,
                  prompt: basePrompt,
                  userPrompt: basePrompt,
                  elapsed: res.elapsed,
                  provider: res.provider,
                  usage: res.usage,
                  quality: res.quality ?? "high",
                  size: res.size ?? size,
                  model: res.model ?? s.imageModel,
                };
            if (!item.image || !item.filename) {
              throw new Error("Generation completed without image data or filename");
            }
            get().addHistoryItem(item);
            set({ unseenGeneratedCount: get().unseenGeneratedCount + 1 });
            generatedCount += 1;
            latestElapsed = Math.max(latestElapsed, Number(item.elapsed) || 0);
            markFlightTerminal(variant.requestId, {
              phase: "completed",
              terminal: true,
              finishedAt: Date.now(),
              durationMs: Date.now() - startedAt,
              meta: {
                kind: "classic",
                variant: "pose",
                posePresetId: variant.preset.id,
                posePresetTitle: variant.preset.title,
                retryAttempt: attempt - 1,
                maxRetryAttempts: 3,
                upstreamRequestId: attemptRequestId,
                retryJitter: jittered.strategy,
              },
            });
            return;
          } catch (err) {
            lastErr = err;
            lastDuration = Date.now() - attemptStartedAt;
            if (attempt < 3 && shouldRetryFastReject(err, attemptStartedAt)) {
              continue;
            }
            break;
          }
        }

        markFlightTerminal(variant.requestId, {
          phase: "error",
          terminal: true,
          finishedAt: Date.now(),
          errorCode: getErrorField(lastErr, "code"),
          errorMessage: getErrorField(lastErr, "message"),
          errorDetails: getErrorDetails(lastErr),
          httpStatus: getErrorStatus(lastErr),
          durationMs: Date.now() - startedAt,
          meta: {
            kind: "classic",
            variant: "pose",
            posePresetId: variant.preset.id,
            posePresetTitle: variant.preset.title,
            retryAttempt: Math.max(0, attemptsUsed - 1),
            maxRetryAttempts: 3,
            lastAttemptDurationMs: lastDuration,
            retryJitter: lastRetryJitter,
          },
        });
      }),
    );

    const finishedIds = new Set(variants.map((variant) => variant.requestId));
    const remaining = get().inFlight.filter((f) => !finishedIds.has(f.id) || f.terminal);
    saveInFlight(remaining);
    set({
      activeGenerations: remaining.filter((f) => !f.terminal).length,
      inFlight: remaining,
    });

    if (generatedCount > 1) {
      get().showToast(
        t("toast.generatedBatch", {
          count: generatedCount,
          elapsed: latestElapsed,
        }),
      );
    } else if (generatedCount === 1) {
      get().showToast(t("toast.generatedSingle", { elapsed: latestElapsed }));
    }
  },

  async generate() {
    const s = get();
    const prompt = composePrompt(s.prompt, s.insertedPrompts);
    if (!prompt) return;
    const useMultimode = s.multimode;
    const pending = getCustomSizeConfirmation(s, {
      kind: useMultimode ? "multimode" : "classic",
    });
    if (pending) {
      set({ customSizeConfirm: pending });
      return;
    }
    if (useMultimode) {
      await get().generateMultimode();
      return;
    }
    await get().runGenerate();
  },

  async generateMultimode(sizeOverride) {
    const s = get();
    const prompt = composePrompt(s.prompt, s.insertedPrompts);
    if (!prompt) return;
    const size = sizeOverride ?? s.getResolvedSize();
    const flightId = `mm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const controller = new AbortController();
    const startedAt = Date.now();
    const requested = normalizeCount(s.multimodeMaxImages);
    const nextInFlight: PersistedInFlight[] = [
      ...s.inFlight,
      { id: flightId, prompt, startedAt, kind: "multimode", phase: "local" },
    ];
    const initialSequence: MultimodeSequenceState = {
      sequenceId: flightId,
      requestId: flightId,
      requested,
      returned: 0,
      images: [],
      partials: [],
      status: "pending",
    };
    saveInFlight(nextInFlight);
    set({
      activeGenerations: s.activeGenerations + 1,
      inFlight: nextInFlight,
      multimodeAbortControllers: {
        ...s.multimodeAbortControllers,
        [flightId]: controller,
      },
      multimodeSequences: {
        ...s.multimodeSequences,
        [flightId]: initialSequence,
      },
      multimodePreviewFlightId: flightId,
    });
    get().startInFlightPolling();

    try {
      set((state) => {
        const next = state.inFlight.map((f) =>
          f.id === flightId && !f.terminal ? { ...f, phase: "requesting" } : f,
        );
        saveInFlight(next);
        return { inFlight: next };
      });
      const res: MultimodeGenerateResponse = await postMultimodeGenerateStream(
        {
          prompt,
          quality: "high" as Quality,
          size,
          format: "png",
          moderation: "low",
          provider: s.provider,
          maxImages: requested,
          model: s.imageModel,
          reasoningEffort: s.reasoningEffort,
          webSearchEnabled: s.webSearchEnabled,
          requestId: flightId,
          mode: s.promptMode,
          ...(s.referenceImages.length
            ? { references: s.referenceImages.map(stripDataUrlPrefix) }
            : {}),
        },
        {
          onPartial: (partial) => {
            set((state) => {
              const current = state.multimodeSequences[flightId];
              if (!current) return {};
              return {
                multimodeSequences: {
                  ...state.multimodeSequences,
                  [flightId]: {
                    ...current,
                    partials: [
                      ...current.partials,
                      { image: partial.image, index: partial.index ?? null },
                    ].slice(-requested),
                  },
                },
              };
            });
          },
          onImage: (image) => {
            set((state) => {
              const current = state.multimodeSequences[flightId];
              if (!current) return {};
              const exists = current.images.some(
                (item) => item.filename && item.filename === image.filename,
              );
              if (exists) return {};
              return {
                multimodeSequences: {
                  ...state.multimodeSequences,
                  [flightId]: {
                    ...current,
                    sequenceId: image.sequenceId ?? current.sequenceId,
                    returned: current.images.length + 1,
                    images: [...current.images, image],
                    status: "partial",
                  },
                },
              };
            });
          },
        },
        { signal: controller.signal },
      );

      const items = res.images.map((image) => ({
        ...image,
        prompt,
        elapsed: Number.parseFloat(res.elapsed),
        provider: res.provider,
        usage: res.usage,
        quality: res.quality ?? "high",
        size: res.size ?? size,
        model: res.model ?? s.imageModel,
      }));
      for (const item of items) {
        get().addHistoryItem(item);
      }
      set((state) => ({
        multimodeSequences: {
          ...state.multimodeSequences,
          [flightId]: {
            sequenceId: res.sequenceId,
            requestId: flightId,
            requested: res.requested,
            returned: res.returned,
            images: items,
            partials: [],
            status: res.status,
            elapsed: res.elapsed,
          },
        },
      }));
      const toastKey =
        res.status === "complete" ? "multimode.complete" : "multimode.partial";
      get().showToast(
        t(toastKey, {
          returned: res.returned,
          requested: res.requested,
          elapsed: res.elapsed,
        }),
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        set((state) => {
          const current = state.multimodeSequences[flightId];
          if (!current) return {};
          return {
            multimodeSequences: {
              ...state.multimodeSequences,
              [flightId]: {
                ...current,
                status: current.images.length > 0 ? "partial" : "empty",
              },
            },
          };
        });
      } else {
        set((state) => {
          const current = state.multimodeSequences[flightId];
          if (!current) return {};
          return {
            multimodeSequences: {
              ...state.multimodeSequences,
              [flightId]: {
                ...current,
                status: "error",
                error: (err as Error).message,
              },
            },
          };
        });
        handleError(err, get());
      }
    } finally {
      const remaining = get().inFlight.filter((f) => f.id !== flightId);
      saveInFlight(remaining);
      set((state) => {
        const nextControllers = { ...state.multimodeAbortControllers };
        delete nextControllers[flightId];
        let nextPreview = state.multimodePreviewFlightId;
        if (nextPreview === flightId) {
          const finalStatus = state.multimodeSequences[flightId]?.status;
          const isCleanFinish =
            finalStatus === "complete" || finalStatus === "partial";
          if (!isCleanFinish) {
            const fallbackIds = Object.keys(nextControllers);
            nextPreview =
              fallbackIds.length > 0
                ? fallbackIds[fallbackIds.length - 1]
                : null;
          }
        }
        return {
          activeGenerations: Math.max(0, state.activeGenerations - 1),
          inFlight: remaining,
          multimodeAbortControllers: nextControllers,
          multimodePreviewFlightId: nextPreview,
        };
      });
    }
  },

  cancelMultimode: () => {
    const flightId = get().multimodePreviewFlightId;
    if (!flightId) return;
    get().multimodeAbortControllers[flightId]?.abort();
    set((state) => {
      const current = state.multimodeSequences[flightId];
      if (!current) return {};
      return {
        multimodeSequences: {
          ...state.multimodeSequences,
          [flightId]: {
            ...current,
            status: current.images.length > 0 ? "partial" : "empty",
          },
        },
      };
    });
  },

  async runGenerate(sizeOverride) {
    const s = get();
    const prompt = composePrompt(s.prompt, s.insertedPrompts);
    if (!prompt) return;

    const size = sizeOverride ?? s.getResolvedSize();
    const requestCount = s.editSourceImage ? 1 : Math.min(10, Math.max(1, normalizeCount(s.count)));
    const startedAt = Date.now();
    const flightIds = Array.from(
      { length: requestCount },
      (_, index) => `f_${startedAt}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    );
    for (const id of flightIds) clientGenerationPendingIds.add(id);
    const nextInFlight: PersistedInFlight[] = [
      ...s.inFlight,
      ...flightIds.map((id) => ({ id, prompt, startedAt, phase: "local" })),
    ];
    saveInFlight(nextInFlight);
    set({
      activeGenerations: s.activeGenerations + flightIds.length,
      inFlight: nextInFlight,
    });
    get().startInFlightPolling();

    const markFlightTerminal = (
      requestId: string,
      patch: Pick<PersistedInFlight, "phase" | "terminal" | "finishedAt"> &
        Partial<
          Pick<
            PersistedInFlight,
            | "errorCode"
            | "errorMessage"
            | "errorDetails"
            | "httpStatus"
            | "durationMs"
            | "meta"
          >
        >,
    ) => {
      clientGenerationPendingIds.delete(requestId);
      const current = get().inFlight.find((f) => f.id === requestId);
      const terminalFlight = current ? { ...current, ...patch } : null;
      const next = get().inFlight.map((f) =>
        f.id === requestId && !f.terminal ? { ...f, ...patch } : f,
      );
      saveInFlight(next);
      set({
        inFlight: next,
        activeGenerations: countActiveInFlight(next),
      });
      if (terminalFlight?.phase === "error") {
        get().recordFailureLog({
          id: terminalFlight.id,
          prompt: terminalFlight.prompt,
          startedAt: terminalFlight.startedAt,
          finishedAt: terminalFlight.finishedAt ?? Date.now(),
          phase: terminalFlight.phase,
          errorCode: terminalFlight.errorCode,
          errorMessage: terminalFlight.errorMessage,
          errorDetails: terminalFlight.errorDetails,
          httpStatus: terminalFlight.httpStatus,
          durationMs: terminalFlight.durationMs,
          kind: terminalFlight.kind,
          meta: terminalFlight.meta,
        });
      }
    };

    const markFlightPhase = (requestId: string, phase: string) => {
      const next = get().inFlight.map((f) =>
        f.id === requestId && !f.terminal ? { ...f, phase } : f,
      );
      saveInFlight(next);
      set({ inFlight: next });
    };

    try {
      const commonPayloadBase = {
        prompt,
        quality: "high" as Quality,
        size,
        format: "png" as Format,
        moderation: "low" as Moderation,
        provider: s.provider,
        model: s.imageModel,
        reasoningEffort: s.reasoningEffort,
        webSearchEnabled: s.webSearchEnabled,
        mode: s.promptMode,
        ...(s.referenceImages.length
          ? { references: s.referenceImages.map(stripDataUrlPrefix) }
          : {}),
      };

      const addResponseToHistory = async (res: GenerateResponse, requestId: string) => {
        if (isMultiResponse(res) && res.images.length > 1) {
          for (const img of res.images) {
            if (!img.image || !img.filename) {
              throw new Error("Generation completed without image data or filename");
            }
            const item: GenerateItem = {
              image: img.image,
              filename: img.filename,
              requestId,
              prompt,
              elapsed: res.elapsed,
              provider: res.provider,
              usage: res.usage,
              quality: res.quality ?? "high",
              size: res.size ?? size,
              model: res.model ?? s.imageModel,
            };
            get().addHistoryItem(item);
            set({ unseenGeneratedCount: get().unseenGeneratedCount + 1 });
          }
          return { count: res.images.length, elapsed: res.elapsed };
        }

        const item: GenerateItem = isMultiResponse(res)
          ? {
              image: res.images[0].image,
              filename: res.images[0].filename,
              requestId,
              prompt,
              elapsed: res.elapsed,
              provider: res.provider,
              usage: res.usage,
              quality: res.quality ?? "high",
              size: res.size ?? size,
              model: res.model ?? s.imageModel,
            }
          : {
              image: res.image,
              filename: res.filename,
              requestId,
              prompt,
              elapsed: res.elapsed,
              provider: res.provider,
              usage: res.usage,
              quality: res.quality ?? "high",
              size: res.size ?? size,
              model: res.model ?? s.imageModel,
            };
        if (!item.image || !item.filename) {
          throw new Error("Generation completed without image data or filename");
        }
        get().addHistoryItem(item);
        set({ unseenGeneratedCount: get().unseenGeneratedCount + 1 });
        return { count: 1, elapsed: res.elapsed };
      };

      if (s.editSourceImage) {
        const editSourceImage = s.editSourceImage;
        const res = await withGenerationPostSlot(async () => {
          markFlightPhase(flightIds[0], "requesting");
          return postEdit({
            ...commonPayloadBase,
            requestId: flightIds[0],
            image: stripDataUrlPrefix(editSourceImage),
            n: 1,
          });
        });
        const added = await addResponseToHistory(res, flightIds[0]);
        markFlightTerminal(flightIds[0], {
          phase: "completed",
          terminal: true,
          finishedAt: Date.now(),
        });
        get().showToast(t("toast.generatedSingle", { elapsed: added.elapsed }));
        set({ editSourceImage: null });
        return;
      }

      let generatedCount = 0;
      let latestElapsed = 0;
      await Promise.all(
        flightIds.map(async (requestId) => {
          try {
            const res = await withGenerationPostSlot(async () => {
              markFlightPhase(requestId, "requesting");
              return postGenerate({
                ...commonPayloadBase,
                requestId,
                n: 1,
              });
            });
            const added = await addResponseToHistory(res, requestId);
            generatedCount += added.count;
            latestElapsed = Math.max(latestElapsed, Number(added.elapsed) || 0);
            markFlightTerminal(requestId, {
              phase: "completed",
              terminal: true,
              finishedAt: Date.now(),
            });
          } catch (err) {
            markFlightTerminal(requestId, {
              phase: "error",
              terminal: true,
              finishedAt: Date.now(),
              errorCode:
                typeof (err as any)?.code === "string"
                  ? (err as any).code
                  : undefined,
              errorMessage:
                typeof (err as any)?.message === "string"
                  ? (err as any).message
                  : undefined,
              errorDetails:
                (err as any)?.details &&
                typeof (err as any).details === "object" &&
                !Array.isArray((err as any).details)
                  ? (err as any).details
                  : undefined,
              httpStatus:
                typeof (err as any)?.status === "number"
                  ? (err as any).status
                  : undefined,
              durationMs: Date.now() - startedAt,
            });
          }
        }),
      );
      if (generatedCount > 1) {
        get().showToast(
          t("toast.generatedBatch", {
            count: generatedCount,
            elapsed: latestElapsed,
          }),
        );
      } else if (generatedCount === 1) {
        get().showToast(t("toast.generatedSingle", { elapsed: latestElapsed }));
      }
    } catch (err) {
      for (const requestId of flightIds) {
        markFlightTerminal(requestId, {
          phase: "error",
          terminal: true,
          finishedAt: Date.now(),
          errorCode:
            typeof (err as any)?.code === "string"
              ? (err as any).code
              : undefined,
          errorMessage:
            typeof (err as any)?.message === "string"
              ? (err as any).message
              : undefined,
          errorDetails:
            (err as any)?.details &&
            typeof (err as any).details === "object" &&
            !Array.isArray((err as any).details)
              ? (err as any).details
              : undefined,
          httpStatus:
            typeof (err as any)?.status === "number"
              ? (err as any).status
              : undefined,
          durationMs: Date.now() - startedAt,
        });
      }
    } finally {
      const finishedIds = new Set(flightIds);
      const remaining = get().inFlight.filter((f) => !finishedIds.has(f.id) || f.terminal);
      saveInFlight(remaining);
      set({
        activeGenerations: remaining.filter((f) => !f.terminal).length,
        inFlight: remaining,
      });
    }
  },

  async confirmCustomSizeAdjustment() {
    const pending = get().customSizeConfirm;
    if (!pending) return;
    const adjustedSize = formatSize(pending.adjustedW, pending.adjustedH);
    set({
      customW: pending.adjustedW,
      customH: pending.adjustedH,
      customSizeConfirm: null,
    });
    if (pending.continuation.kind === "classic") {
      await get().runGenerate(adjustedSize);
      return;
    }
    if (pending.continuation.kind === "multimode") {
      await get().generateMultimode(adjustedSize);
      return;
    }
  },

  cancelCustomSizeAdjustment: () => set({ customSizeConfirm: null }),

  hydrateHistory() {
    void (async () => {
      try {
        const res = await getHistory({ limit: HISTORY_LIMIT });
        const history: GenerateItem[] = res.items
          .map(mapHistoryItem)
          .filter((item) => !pendingDeletedFilenames.has(item.filename ?? ""));
        if (history.length > 0) {
          const selected = loadSelectedFilename();
          const matched = selected
            ? history.find((it) => it.filename === selected)
            : null;
          const visibleHistory = getVisibleGalleryItems(history);
          const currentImage =
            (matched
              ? resolveVisibleShortcutCurrent(history, matched)
              : null) ??
            visibleHistory[0] ??
            null;
          set({ history, currentImage });
          if (currentImage?.filename !== selected) {
            saveSelectedFilename(currentImage?.filename ?? null);
          }
        }
      } catch (err) {
        console.warn("[history] load failed:", err);
      }
    })();
  },

  showToast(message, error = false) {
    set({ toast: { message, error, id: Date.now() + Math.random() } });
  },
  showErrorCard(code, params) {
    set({
      errorCard: {
        code,
        fallbackMessage: params?.fallbackMessage,
        id: Date.now() + Math.random(),
      },
    });
  },
  dismissErrorCard() {
    set({ errorCard: null });
  },

  // ── Prompt Library actions (0.23) ──
  togglePromptLibrary() {
    set((s) => ({ promptLibraryOpen: !s.promptLibraryOpen }));
  },

  async loadPromptLibrary() {
    set({ promptLibraryLoading: true });
    try {
      const data = await getPromptLibrary();
      set({
        promptLibrary: { prompts: data.prompts, folders: data.folders },
        promptLibraryLoading: false,
      });
    } catch (err) {
      console.error("[PromptLibrary] load failed", err);
      set({ promptLibraryLoading: false });
    }
  },

  async savePromptToLibrary(payload) {
    try {
      const { prompt } = await createPrompt(payload);
      set((s) => ({
        promptLibrary: {
          ...s.promptLibrary,
          prompts: [
            prompt,
            ...s.promptLibrary.prompts.filter((item) => item.id !== prompt.id),
          ],
        },
      }));
      void get().loadPromptLibrary();
      get().showToast(t("promptLibrary.saved"));
    } catch (err) {
      console.error("[PromptLibrary] save failed", err);
      get().showToast(t("promptLibrary.saveFailed"), true);
    }
  },

  async updatePromptInLibrary(id, payload) {
    try {
      const { prompt } = await updatePrompt(id, payload);
      set((s) => ({
        promptLibrary: {
          ...s.promptLibrary,
          prompts: [
            prompt,
            ...s.promptLibrary.prompts.filter((item) => item.id !== id),
          ],
        },
      }));
      get().showToast(t("common.saved"));
    } catch (err) {
      console.error("[PromptLibrary] update failed", err);
      get().showToast(t("common.error"), true);
    }
  },

  async deletePromptFromLibrary(id) {
    try {
      await deletePrompt(id);
      set((s) => ({
        promptLibrary: {
          ...s.promptLibrary,
          prompts: s.promptLibrary.prompts.filter((item) => item.id !== id),
        },
      }));
      void get().loadPromptLibrary();
    } catch (err) {
      console.error("[PromptLibrary] delete failed", err);
      get().showToast(t("common.error"), true);
    }
  },

  async togglePromptFavorite(id) {
    try {
      const result = await togglePromptFavorite(id);
      set((s) => ({
        promptLibrary: {
          ...s.promptLibrary,
          prompts: s.promptLibrary.prompts.map((item) =>
            item.id === id
              ? {
                  ...item,
                  isFavorite: result.isFavorite,
                  favoritedAt: result.favoritedAt,
                }
              : item,
          ),
        },
      }));
    } catch (err) {
      console.error("[PromptLibrary] favorite toggle failed", err);
    }
  },

  async importPromptsToLibrary(files) {
    try {
      const prompts: Array<{ name: string; text: string; tags: string[] }> = [];
      for (const file of files) {
        if (!/\.(txt|md|markdown)$/i.test(file.name)) continue;
        const text = await file.text();
        if (!text.trim()) continue;
        const name = file.name.replace(/\.(txt|md|markdown)$/i, "");
        prompts.push({
          name: name.trim() || t("promptLibrary.untitled"),
          text: text.trim(),
          tags: [],
        });
      }
      if (prompts.length === 0) {
        get().showToast(t("promptLibrary.importNoValidFiles"), true);
        return;
      }
      const result = await importPromptLibrary({ prompts });
      await get().loadPromptLibrary();
      get().showToast(
        t("promptLibrary.imported", { count: result.promptsImported }),
      );
    } catch (err) {
      console.error("[PromptLibrary] import failed", err);
      get().showToast(t("promptLibrary.importFailed"), true);
    }
  },

  async toggleGalleryFavorite(filename) {
    try {
      const result = await toggleGalleryFavorite(filename);
      set((s) => {
        const next = new Set(s.galleryFavorites);
        if (result.isFavorite) next.add(filename);
        else next.delete(filename);
        return { galleryFavorites: next };
      });
      // Also update history items in place
      set((s) => ({
        history: s.history.map((h) =>
          h.filename === filename ? { ...h, isFavorite: result.isFavorite } : h,
        ),
      }));
    } catch (err) {
      console.error("[GalleryFavorite] toggle failed", err);
    }
  },

  // Canvas Mode actions (0.24)
  openCanvas: () =>
    set({ canvasOpen: true, canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 }),
  closeCanvas: () => set({ canvasOpen: false }),
  setCanvasZoom: (zoom) =>
    set({ canvasZoom: Math.max(0.5, Math.min(3, zoom)) }),
  resetCanvasZoom: () => set({ canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 }),
  setCanvasPan: (x, y) => {
    const cap = 4000;
    set({
      canvasPanX: Math.max(-cap, Math.min(cap, x)),
      canvasPanY: Math.max(-cap, Math.min(cap, y)),
    });
  },
  resetCanvasPan: () => set({ canvasPanX: 0, canvasPanY: 0 }),
  setCanvasExportBackground: (mode) => {
    set({ canvasExportBackground: mode });
    persistCanvasExportBackground(mode, get().canvasExportMatteColor);
  },
  setCanvasExportMatteColor: (color) => {
    set({ canvasExportMatteColor: color });
    persistCanvasExportBackground(get().canvasExportBackground, color);
  },
}));
