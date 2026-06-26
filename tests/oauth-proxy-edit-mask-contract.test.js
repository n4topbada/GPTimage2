import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("oauth proxy edit mask contract", () => {
  it("forwards validated masked edits through the image generation tool", () => {
    const source = readSource("lib/oauthProxy.ts");
    assert.match(source, /const maskB64 = typeof options\.mask === "string"/);
    assert.match(source, /input_image_mask/);
    assert.match(source, /data:image\/png;base64,\$\{maskB64\}/);
    assert.match(source, /data:image\/\$\{maskB64 \? "png" : "jpeg"\};base64/);
    assert.doesNotMatch(source, /EDIT_MASK_NOT_SUPPORTED/);
  });
});
