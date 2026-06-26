import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("web search toggle contract", () => {
  it("surfaces the prompt-mode and web-search controls in the prompt composer", () => {
    const composer = readSource("ui/src/components/prompt/PromptComposer.tsx");

    assert.match(composer, /setPromptMode\("direct"\)/);
    assert.match(composer, /setPromptMode\("auto"\)/);
    assert.match(composer, /setWebSearchEnabled\(true\)/);
    assert.match(composer, /setWebSearchEnabled\(false\)/);
  });

  it("persists the toggle and sends it with generation requests", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const types = readSource("ui/src/types.ts");

    assert.match(types, /webSearchEnabled\?: boolean/);
    assert.match(store, /WEB_SEARCH_STORAGE_KEY/);
    assert.match(store, /initialWebSearchEnabled/);
    assert.match(store, /webSearchEnabled: s\.webSearchEnabled/);
  });

  it("keeps server search off by default and removes web_search when off", () => {
    const generate = readSource("routes/generate.ts");
    const oauth = readSource("lib/oauthProxy.ts");

    assert.match(generate, /webSearchEnabled: rawWebSearchEnabled = false/);
    assert.match(oauth, /function resolveWebSearchEnabled/);
    assert.match(oauth, /\.\.\(webSearchEnabled \? \[\{ type: "web_search" \}\] : \[\]\)/);
  });
});
