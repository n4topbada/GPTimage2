import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeImageModel } from "../lib/imageModels";

describe("image model normalization", () => {
  it("defaults to gpt-5.4-mini without route config", () => {
    assert.deepEqual(normalizeImageModel({}, undefined), { model: "gpt-5.4-mini" });
  });

  it("accepts supported image models", () => {
    assert.deepEqual(normalizeImageModel({}, "gpt-5.5"), { model: "gpt-5.5" });
    assert.deepEqual(normalizeImageModel({}, "gpt-5.4"), { model: "gpt-5.4" });
    assert.deepEqual(normalizeImageModel({}, "gpt-5.4-mini"), { model: "gpt-5.4-mini" });
  });

  it("rejects known unsupported OAuth models", () => {
    const result = normalizeImageModel({}, "gpt-5.3-codex-spark");
    assert.equal(result.code, "IMAGE_MODEL_UNSUPPORTED");
    assert.equal(result.status, 400);
  });

  it("rejects unknown models", () => {
    const result = normalizeImageModel({}, "bad-model");
    assert.equal(result.code, "INVALID_IMAGE_MODEL");
    assert.equal(result.status, 400);
  });
});

