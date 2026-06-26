import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("pose variant generation keeps display prompt separate from transmitted prompt", () => {
  const root = process.cwd();
  const store = readFileSync(join(root, "ui", "src", "store", "useAppStore.ts"), "utf8");
  const route = readFileSync(join(root, "routes", "generate.ts"), "utf8");

  assert.match(store, /prompt:\s*jittered\.prompt/);
  assert.match(store, /displayPrompt:\s*basePrompt/);
  assert.match(store, /prompt:\s*basePrompt/);
  assert.match(store, /userPrompt:\s*basePrompt/);
  assert.match(route, /displayPrompt:\s*rawDisplayPrompt/);
  assert.match(route, /userPrompt:\s*displayPrompt/);
});
