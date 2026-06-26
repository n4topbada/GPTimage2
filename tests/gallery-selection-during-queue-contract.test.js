import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

test("history selection exits multimode preview while other queue items continue", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /selectHistory: \(item\) => \{/);
  assert.match(store, /multimodePreviewFlightId: null/);
});

test("fresh generated data URLs render directly in the main viewer", () => {
  const canvas = readSource("ui/src/components/result/Canvas.tsx");
  const helpers = readSource("ui/src/components/canvas-mode/canvasModeHelpers.ts");

  assert.match(
    canvas,
    /image\.image\?\.startsWith\("data:"\) \? image\.image : \(image\.url \?\? image\.image\)/,
  );
  assert.match(
    helpers,
    /image\.image\?\.startsWith\("data:"\) \? image\.image : \(image\.url \?\? image\.image\)/,
  );
});

test("viewer can clear the current image selection without deleting history", () => {
  const store = readSource("ui/src/store/useAppStore.ts");
  const actions = readSource("ui/src/components/result/ResultActions.tsx");
  const en = readSource("ui/src/i18n/en.json");
  const ko = readSource("ui/src/i18n/ko.json");

  assert.match(store, /hideCurrentImage: \(\) => \{/);
  assert.match(store, /saveSelectedFilename\(null\);/);
  assert.match(store, /currentImage: null/);
  assert.match(store, /multimodePreviewFlightId: null/);
  assert.match(actions, /const hideCurrentImage = useAppStore\(\(s\) => s\.hideCurrentImage\);/);
  assert.match(actions, /onClick=\{hideCurrentImage\}/);
  assert.match(en, /"hideImage": "Hide"/);
  assert.match(ko, /"hideImage": "숨기기"/);
});

test("history deletion is optimistic and not re-added by polling while loading", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /const pendingDeletedFilenames = new Set<string>\(\);/);
  assert.match(store, /function rememberPendingDeletedFilename\(filename: string\): void/);
  assert.match(store, /pendingDeletedFilenames\.has\(a\.filename \?\? ""\)/);
  assert.match(store, /pendingDeletedFilenames\.has\(item\.filename \?\? ""\)/);
  assert.match(store, /rememberPendingDeletedFilename\(filename\);/);
  assert.match(store, /await deleteHistoryItem\(filename\);/);
  assert.match(store, /pendingDeletedFilenames\.delete\(filename\);/);
});
