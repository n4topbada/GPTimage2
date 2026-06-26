import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("generation controls UX contract", () => {
  it("keeps the right panel as the generation control home", () => {
    const rightPanel = readSource("ui/src/components/layout/RightPanel.tsx");

    assert.match(rightPanel, /import \{ SizePicker \} from "\.\.\/generation\/SizePicker"/);
    assert.match(rightPanel, /import \{ GenerationModePicker \} from "\.\.\/generation\/GenerationModePicker"/);
    assert.match(rightPanel, /lazy\(\(\) =>\s*import\("\.\.\/prompt\/PromptLibraryPanel"\)/);
    assert.match(rightPanel, /<SizePicker \/>/);
    assert.match(rightPanel, /<GenerationModePicker \/>/);
    assert.match(rightPanel, /<LazyPromptLibraryPanel variant="embedded" \/>/);
    assert.match(rightPanel, /right-panel-library/);
    assert.doesNotMatch(rightPanel, /promptLibraryOpen/);
    assert.doesNotMatch(rightPanel, /right-panel-tabs/);
    assert.doesNotMatch(rightPanel, /CostEstimate/);
    assert.doesNotMatch(rightPanel, /fixedPng/);
    assert.doesNotMatch(rightPanel, /fixedLow/);
    assert.doesNotMatch(rightPanel, /<OptionGroup<Format>/);
    assert.doesNotMatch(rightPanel, /<OptionGroup<Moderation>/);
  });

  it("uses the requested low and high resolution ratio matrix", () => {
    const sizePicker = readSource("ui/src/components/generation/SizePicker.tsx");

    assert.match(sizePicker, /value: "auto"/);
    assert.match(sizePicker, /label: "자동"/);
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
      assert.match(sizePicker, new RegExp(size));
    }
    for (const ratio of ["16:9", "3:2", "2:3", "9:16", "1:1"]) {
      assert.match(sizePicker, new RegExp(ratio));
    }
    assert.doesNotMatch(sizePicker, /저/);
    assert.doesNotMatch(sizePicker, /고/);
    assert.doesNotMatch(sizePicker, /title=\{t\("size\.title"\)\}/);
    assert.doesNotMatch(sizePicker, /4096x4096/);
    assert.doesNotMatch(sizePicker, /ResolutionLevel/);
    assert.doesNotMatch(sizePicker, /normalizeCustomSizePair/);
  });

  it("keeps the requested size matrix in the SizePreset union", () => {
    const types = readSource("ui/src/types.ts");
    const sizePresetBlock = types.match(/export type SizePreset =[\s\S]*?;/)?.[0] ?? "";

    assert.match(sizePresetBlock, /export type SizePreset =/);
    assert.match(sizePresetBlock, /"auto"/);
    assert.match(sizePresetBlock, /"2048x1152"/);
    assert.match(sizePresetBlock, /"1872x1248"/);
    assert.match(sizePresetBlock, /"1248x1872"/);
    assert.match(sizePresetBlock, /"1152x2048"/);
    assert.match(sizePresetBlock, /"1536x1536"/);
    assert.match(sizePresetBlock, /"3840x2160"/);
    assert.match(sizePresetBlock, /"3520x2352"/);
    assert.match(sizePresetBlock, /"2352x3520"/);
    assert.match(sizePresetBlock, /"2160x3840"/);
    assert.match(sizePresetBlock, /"2880x2880"/);
    assert.match(sizePresetBlock, /"custom"/);
  });

  it("offers direct multi request counts up to ten and staged modes", () => {
    const modePicker = readSource("ui/src/components/generation/GenerationModePicker.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(modePicker, /"single"/);
    assert.match(modePicker, /"multi2"/);
    assert.match(modePicker, /"multi3"/);
    assert.match(modePicker, /"multi4"/);
    assert.match(modePicker, /"multi5"/);
    assert.match(modePicker, /"sequence2"/);
    assert.match(modePicker, /"sequence4"/);
    assert.match(modePicker, /setCount\(1\)/);
    assert.match(modePicker, /setCount\(2\)/);
    assert.match(modePicker, /setCount\(3\)/);
    assert.match(modePicker, /setCount\(4\)/);
    assert.match(modePicker, /setCount\(5\)/);
    assert.match(modePicker, /setMultimode\(true\)/);
    assert.match(store, /Math\.min\(10, Math\.max\(1, normalizeCount\(s\.count\)\)\)/);
    assert.match(store, /await Promise\.all\(/);
    assert.match(store, /flightIds\.map\(async \(requestId\) =>/);
    assert.match(store, /const added = await addResponseToHistory\(res, requestId\);/);
    assert.match(store, /markFlightTerminal\(requestId, \{\s*phase: "completed"/);
    assert.match(store, /n: 1/);
    assert.doesNotMatch(store, /Promise\.allSettled\(/);
    assert.doesNotMatch(store, /n: s\.count/);
    assert.match(store, /function normalizeCount\(value: number\): Count/);
    assert.match(store, /const next = normalizeCount\(count\);/);
    assert.match(store, /saveGenerationDefaultsPatch\(\{ count: next \}\);/);
  });

  it("persists prompt and generation presets across refresh", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /GENERATION_DEFAULTS_STORAGE_KEY = "ima2\.generationDefaults"/);
    assert.match(store, /function loadGenerationDefaults\(\): GenerationDefaults/);
    assert.match(store, /function saveGenerationDefaultsPatch\(patch: GenerationDefaults\): void/);
    assert.match(store, /prompt: storedGenerationDefaults\.prompt \?\? ""/);
    assert.match(store, /sizePreset: storedGenerationDefaults\.sizePreset \?\? "1536x1536"/);
    assert.match(store, /setPrompt: \(prompt\) => \{[\s\S]*?saveGenerationDefaultsPatch\(\{ prompt \}\);/);
    assert.match(store, /setSizePreset: \(sizePreset\) => \{[\s\S]*?saveGenerationDefaultsPatch\(\{ sizePreset \}\);/);
    assert.match(store, /saveGenerationDefaultsPatch\(\{ insertedPrompts \}\);/);
  });

  it("keeps high quality fixed in generation requests", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /quality: "high"/);
    assert.match(store, /quality: "high" as Quality/);
    assert.doesNotMatch(readSource("ui/src/components/layout/RightPanel.tsx"), /setQuality/);
  });

  it("matches the server-side image tool size allowlist", () => {
    const imageToolSize = readSource("lib/imageToolSize.ts");
    const sizePicker = readSource("ui/src/components/generation/SizePicker.tsx");

    assert.match(imageToolSize, /"auto"/);
    assert.match(sizePicker, /value: "auto"/);
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
      assert.match(imageToolSize, new RegExp(`"${size}"`));
      assert.match(sizePicker, new RegExp(`${size}`));
    }
  });

  it("keeps measured image tool constraints in shared sizing helpers", () => {
    const sizeLib = readSource("ui/src/lib/size.ts");

    assert.match(sizeLib, /IMAGE_SIZE_MAX_EDGE = 3840/);
    assert.match(sizeLib, /IMAGE_SIZE_MAX_PIXELS = 8_294_400/);
  });
});
