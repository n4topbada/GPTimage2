import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

const MIN = 16;
const MAX = 3840;
const MAX_RATIO = 3;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;

function snap16(n) {
  return Math.round(n / 16) * 16;
}

function floor16(n) {
  return Math.floor(n / 16) * 16;
}

function ceil16(n) {
  return Math.ceil(n / 16) * 16;
}

function clamp(n) {
  return Math.min(MAX, Math.max(MIN, n));
}

function parseSide(value, fallback) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fitRatio(w, h) {
  if (w > h * MAX_RATIO) return { w, h: clamp(ceil16(w / MAX_RATIO)), reason: "ratio" };
  if (h > w * MAX_RATIO) return { w: clamp(ceil16(h / MAX_RATIO)), h, reason: "ratio" };
  return { w, h, reason: null };
}

function fitPixels(w, h) {
  if (w * h < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / (w * h));
    let nextW = clamp(ceil16(w * scale));
    let nextH = clamp(ceil16(h * scale));
    while (nextW * nextH < MIN_PIXELS) {
      if (nextW <= nextH) nextW = clamp(nextW + 16);
      else nextH = clamp(nextH + 16);
    }
    return { w: nextW, h: nextH, reason: "minPixels" };
  }
  if (w * h <= MAX_PIXELS) return { w, h, reason: null };
  const scale = Math.sqrt(MAX_PIXELS / (w * h));
  let nextW = clamp(floor16(w * scale));
  let nextH = clamp(floor16(h * scale));
  while (nextW * nextH > MAX_PIXELS) {
    if (nextW >= nextH) nextW = clamp(nextW - 16);
    else nextH = clamp(nextH - 16);
  }
  return { w: nextW, h: nextH, reason: "maxPixels" };
}

function normalizePair(rawW, rawH, fallbackW, fallbackH) {
  const reasons = [];
  const requestedW = parseSide(rawW, fallbackW);
  const requestedH = parseSide(rawH, fallbackH);
  let w = snap16(requestedW);
  let h = snap16(requestedH);
  if (w !== requestedW || h !== requestedH) reasons.push("snap");
  if (w < MIN || h < MIN) reasons.push("min");
  if (w > MAX || h > MAX) reasons.push("max");
  w = clamp(w);
  h = clamp(h);
  let fitted = fitRatio(w, h);
  if (fitted.reason) reasons.push(fitted.reason);
  ({ w, h } = fitted);
  fitted = fitPixels(w, h);
  if (fitted.reason) reasons.push(fitted.reason);
  ({ w, h } = fitted);
  fitted = fitRatio(w, h);
  if (fitted.reason && !reasons.includes(fitted.reason)) reasons.push(fitted.reason);
  ({ w, h } = fitted);
  return { w, h, adjusted: w !== requestedW || h !== requestedH, reasons };
}

describe("size preset contract", () => {
  it("renders the supported low/high resolution presets without custom inputs", () => {
    const source = readSource("ui/src/components/generation/SizePicker.tsx");

    for (const size of [
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
    ]) {
      assert.match(source, new RegExp(size));
    }
    for (const ratio of ["16:9", "3:2", "2:3", "9:16", "1:1"]) {
      assert.match(source, new RegExp(ratio));
    }
    assert.match(source, /OptionGroup<SizePreset>/);
    assert.doesNotMatch(source, /commitCustomSize/);
    assert.doesNotMatch(source, /setDraftW/);
    assert.doesNotMatch(source, /type="number"/);
  });

  it("keeps requested custom sizes in the store until generation time", () => {
    const source = readSource("ui/src/store/useAppStore.ts");

    assert.match(source, /parseRequestedCustomSide\(w, state\.customW\)/);
    assert.match(source, /parseRequestedCustomSide\(h, state\.customH\)/);
    assert.doesNotMatch(source, /const next = normalizeCustomSizePair\(w, h, state\.customW, state\.customH\)/);
    assert.doesNotMatch(source, /setCustomSize: \(w, h\) => set\(\{ customW: snap16\(w\)/);
  });

  it("documents pair-level custom size constraints in the helper", () => {
    const source = readSource("ui/src/lib/size.ts");

    assert.match(source, /export const IMAGE_SIZE_MAX_EDGE = 3840/);
    assert.match(source, /export const IMAGE_SIZE_MIN_PIXELS = 655_360/);
    assert.match(source, /export const IMAGE_SIZE_MAX_PIXELS = 8_294_400/);
    assert.match(source, /export const IMAGE_SIZE_MAX_RATIO = 3/);
    assert.match(source, /export const CUSTOM_SIZE_MAX = IMAGE_SIZE_MAX_EDGE/);
    assert.match(source, /export type CustomSizeAdjustmentReason/);
    assert.match(source, /export function normalizeCustomSizePairDetailed/);
    assert.match(source, /export function normalizeCustomSizePair/);
  });

  it("gates classic and multimode generation before creating in-flight work", () => {
    const source = readSource("ui/src/store/useAppStore.ts");

    assert.match(source, /customSizeConfirm: CustomSizeConfirmState/);
    assert.match(source, /continuation:\s*\n\s*\| \{ kind: "classic" \}/);
    assert.match(source, /\| \{ kind: "multimode" \}/);
    assert.doesNotMatch(source, /\| \{ kind: "node"; clientId: ClientNodeId \}/);
    assert.match(source, /const useMultimode = s\.multimode/);
    assert.match(source, /getCustomSizeConfirmation\(s, \{\s*kind: useMultimode \? "multimode" : "classic",\s*\}\)/);
    assert.match(source, /runGenerate: \(sizeOverride\?: string\) => Promise<void>/);
    assert.match(source, /generateMultimode: \(sizeOverride\?: string\) => Promise<void>/);
    assert.match(source, /await get\(\)\.runGenerate\(adjustedSize\)/);
    assert.match(source, /await get\(\)\.generateMultimode\(adjustedSize\)/);
  });

  it("renders an accessible blocking confirm modal above other overlays", () => {
    const modal = readSource("ui/src/components/feedback/CustomSizeConfirmModal.tsx");
    const app = readSource("ui/src/App.tsx");
    const css = readSource("ui/src/index.css");
    const backdropRule = /\.custom-size-confirm-backdrop\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(app, /<CustomSizeConfirmModal \/>/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal="true"/);
    assert.match(modal, /aria-labelledby="custom-size-confirm-title"/);
    assert.match(modal, /aria-describedby="custom-size-confirm-body"/);
    assert.match(modal, /if \(e\.key === "Escape"\) cancel\(\)/);
    assert.match(modal, /cancelRef\.current\?\.focus\(\)/);
    assert.match(backdropRule, /z-index:\s*230/);
  });

  it("has localized size confirmation copy", () => {
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    for (const source of [ko, en]) {
      assert.match(source, /"sizeConfirm"/);
      assert.match(source, /"requested"/);
      assert.match(source, /"adjusted"/);
      assert.match(source, /"approve"/);
      assert.match(source, /"reasonRatio"/);
      assert.match(source, /"reasonPixels"/);
    }
  });

  it("does not keep custom input layout rules in the right panel", () => {
    const source = readSource("ui/src/index.css");

    assert.doesNotMatch(source, /\.custom-size-input/);
  });

  it("mirrors expected custom size normalization examples", () => {
    assert.deepEqual(normalizePair("900", "2048", 1920, 1088), {
      w: 896,
      h: 2048,
      adjusted: true,
      reasons: ["snap"],
    });
    assert.deepEqual(normalizePair("1024", "3840", 1920, 1088), {
      w: 1280,
      h: 3840,
      adjusted: true,
      reasons: ["ratio"],
    });
    assert.deepEqual(normalizePair("3840", "1024", 1920, 1088), {
      w: 3840,
      h: 1280,
      adjusted: true,
      reasons: ["ratio"],
    });
    assert.deepEqual(normalizePair("3840", "3840", 1920, 1088), {
      w: 2880,
      h: 2880,
      adjusted: true,
      reasons: ["maxPixels"],
    });
    assert.deepEqual(normalizePair("512", "512", 1920, 1088), {
      w: 816,
      h: 816,
      adjusted: true,
      reasons: ["minPixels"],
    });
    assert.deepEqual(normalizePair("", "", 2048, 2048), {
      w: 2048,
      h: 2048,
      adjusted: false,
      reasons: [],
    });
  });
});
