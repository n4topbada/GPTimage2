import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import type { GenerateItem } from "../../types";
import type { ReactNode } from "react";

interface ResultActionsProps {
  imageOverride?: GenerateItem | null;
}

const CANVAS_MODE_PROMPT_ID = "canvas-mode-context";
const CANVAS_MODE_PROMPT_NAME = "Canvas Mode";
const CANVAS_MODE_PROMPT_TEXT = [
  "Canvas Mode context:",
  "The user edited or annotated the reference image on a canvas.",
  "If the image is a blank white canvas or paper with user-drawn strokes, treat those strokes as source content and preserve/complete them.",
  "If the image is an existing picture with circles, arrows, sticky notes, handwritten marks, or memo notes over it, treat those marks as edit instructions. Apply the instruction, then remove the marks from the final image unless explicitly asked to keep them.",
  "Infer the intended edit from the canvas marks and memo text. Preserve unrelated image content.",
].join("\n");

export function ResultActions({ imageOverride = null }: ResultActionsProps) {
  const { t } = useI18n();
  const currentImage = useAppStore((s) => s.currentImage);
  const showToast = useAppStore((s) => s.showToast);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const insertPromptToComposer = useAppStore((s) => s.insertPromptToComposer);
  const useImageAsReference = useAppStore((s) => s.useImageAsReference);
  const setEditSourceFromItem = useAppStore((s) => s.setEditSourceFromItem);
  const trashHistoryItem = useAppStore((s) => s.trashHistoryItem);
  const hideCurrentImage = useAppStore((s) => s.hideCurrentImage);
  const canvasOpen = useAppStore((s) => s.canvasOpen);

  const actionImage = imageOverride ?? currentImage;
  if (!actionImage) return null;

  const download = () => {
    const a = document.createElement("a");
    a.href = actionImage.image;
    a.download = actionImage.filename || "generated.png";
    a.click();
  };

  const copyImage = async () => {
    try {
      const res = await fetch(actionImage.image);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      showToast(t("toast.imageCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  };

  const copyPrompt = () => {
    if (!actionImage.prompt) return;
    void navigator.clipboard.writeText(actionImage.prompt);
    showToast(t("toast.promptCopied"));
  };

  const newFromHere = async () => {
    const hasPrompt = Boolean(actionImage.prompt);
    if (hasPrompt) setPrompt(actionImage.prompt as string);
    try {
      await useImageAsReference(actionImage);
    } catch {
      // non-fatal — fall back to prompt-only fork
    }
    if (canvasOpen && imageOverride) {
      insertPromptToComposer({
        id: CANVAS_MODE_PROMPT_ID,
        name: CANVAS_MODE_PROMPT_NAME,
        text: CANVAS_MODE_PROMPT_TEXT,
      });
    }
    const promptEl = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="prompt"], textarea#prompt, .sidebar textarea',
    );
    if (promptEl) {
      promptEl.focus();
      promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
    }
    showToast(t(hasPrompt ? "toast.forkStarted" : "toast.forkStartedNoPrompt"));
  };

  const editThisImage = async () => {
    if (actionImage.prompt) setPrompt(actionImage.prompt);
    await setEditSourceFromItem(actionImage);
  };

  return (
    <div className="result-actions">
      <button type="button" className="action-btn" onClick={download} aria-label={t("result.download")} title={t("result.download")}>
        <DownloadIcon />
      </button>
      <button type="button" className="action-btn" onClick={copyImage} aria-label={t("result.copyImage")} title={t("result.copyImage")}>
        <CopyImageIcon />
      </button>
      <button type="button" className="action-btn" onClick={copyPrompt} aria-label={t("result.copyPrompt")} title={t("result.copyPrompt")}>
        <CopyPromptIcon />
      </button>
      {!imageOverride ? (
        <button
          type="button"
          className="action-btn"
          onClick={hideCurrentImage}
          aria-label={t("result.hideImage")}
          title={t("result.hideImageTitle")}
        >
          <HideIcon />
        </button>
      ) : null}
      <button
        type="button"
        className="action-btn action-btn--primary"
        onClick={newFromHere}
        aria-label={t("result.continueHere")}
        title={t("result.continueHereTitle")}
      >
        <ContinueIcon />
      </button>
      <button
        type="button"
        className="action-btn"
        onClick={() => void editThisImage()}
        aria-label={t("result.editThis")}
        title={t("result.editThisTitle")}
      >
        <EditIcon />
      </button>

      {actionImage.filename && (
        <button
          type="button"
          className="action-btn action-btn--danger"
          onClick={() => void trashHistoryItem(actionImage)}
          aria-label={t("result.delete")}
          title={t("result.deleteTitle")}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function DownloadIcon() {
  return (
    <IconBase>
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </IconBase>
  );
}

function CopyImageIcon() {
  return (
    <IconBase>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      <path d="m11 15 2-2 2 2 1-1 2 2" />
    </IconBase>
  );
}

function CopyPromptIcon() {
  return (
    <IconBase>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      <path d="M11 12h5" />
      <path d="M11 15h4" />
    </IconBase>
  );
}

function HideIcon() {
  return (
    <IconBase>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 8.5 4.5 9.5 6a13.2 13.2 0 0 1-3.1 3.5" />
      <path d="M6.6 6.6A13.2 13.2 0 0 0 2.5 10c1 1.5 4.5 6 9.5 6 1.1 0 2.1-.2 3-.6" />
    </IconBase>
  );
}

function ContinueIcon() {
  return (
    <IconBase>
      <path d="M5 12h12" />
      <path d="m13 8 4 4-4 4" />
      <path d="M5 5v14" />
    </IconBase>
  );
}

function EditIcon() {
  return (
    <IconBase>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14 7 3 3" />
    </IconBase>
  );
}

function TrashIcon() {
  return (
    <IconBase>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </IconBase>
  );
}
