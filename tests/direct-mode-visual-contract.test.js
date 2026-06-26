import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("direct mode visual contract", () => {
  it("marks direct mode on the prompt composer without showing a duplicate badge", () => {
    const composer = readSource("ui/src/components/prompt/PromptComposer.tsx");

    assert.match(composer, /const isDirectMode = promptMode === "direct"/);
    assert.match(composer, /isDirectMode && !multimode \? " composer--direct" : ""/);
    assert.match(composer, /multimode \? " composer--multimode" : ""/);
    assert.match(composer, /aria-pressed=\{isDirectMode\}/);
    assert.doesNotMatch(composer, /composer__direct-badge/);
    assert.doesNotMatch(composer, /prompt\.directModeActive/);
  });

  it("styles direct mode separately from the multimode composer state", () => {
    const css = readSource("ui/src/index.css");

    assert.match(css, /\.composer--direct\s*\{/);
    assert.doesNotMatch(css, /\.composer__direct-badge\s*\{/);
    assert.match(css, /\.composer--multimode\s*\{/);
    assert.match(css, /\.composer__mode-badge\s*\{/);
    assert.match(css, /\.composer__tool--on\s*\{/);
  });

  it("uses concise prompt mode labels in both locales", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.equal(en.prompt.useCurrent, "Reference");
    assert.equal(en.prompt.useCurrentAsEdit, "Edit");
    assert.equal(ko.prompt.useCurrent, "참조");
    assert.equal(ko.prompt.useCurrentAsEdit, "수정");
    assert.equal(ko.prompt.directMode, "원문");
  });
});
