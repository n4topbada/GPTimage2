import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_POSE_PRESETS,
  jitterPoseSectionOrderForRetry,
  replacePoseSection,
} from "../ui/src/lib/poseVariants.ts";

test("default pose presets provide ten editable pose sections", () => {
  assert.equal(DEFAULT_POSE_PRESETS.length, 10);
  assert.equal(DEFAULT_POSE_PRESETS[0].title, "01 기본 정면 스탠딩 포즈");
  for (const preset of DEFAULT_POSE_PRESETS) {
    assert.match(preset.body, /^\[pose\]\n.+/);
    assert.doesNotMatch(preset.body.toLowerCase(), /expression|smile|face expression/);
  }
});

test("replacePoseSection replaces only the pose block", () => {
  const prompt = [
    "[character]",
    "Hero design",
    "",
    "[pose]",
    "old pose",
    "old pose detail",
    "",
    "[outfit]",
    "Blue jacket",
  ].join("\n");

  const next = replacePoseSection(prompt, DEFAULT_POSE_PRESETS[1]);
  assert.match(next, /\[character\]\nHero design/);
  assert.match(next, /\[pose\]\n02 한손 허리 콘트라포스토 포즈/);
  assert.doesNotMatch(next, /old pose/);
  assert.match(next, /\[outfit\]\nBlue jacket/);
});

test("replacePoseSection appends pose block when no pose section exists", () => {
  const next = replacePoseSection("[character]\nHero design", DEFAULT_POSE_PRESETS[0]);
  assert.match(next, /\[character\]\nHero design/);
  assert.match(next, /\[pose\]\n01 기본 정면 스탠딩 포즈/);
});

test("jitterPoseSectionOrderForRetry moves pose without changing section text", () => {
  const prompt = [
    "[character]",
    "Hero design",
    "",
    "[outfit]",
    "Blue jacket",
    "",
    "[pose]",
    "05 무릎 앉은 포즈",
    "Kneeling seated pose.",
    "",
    "[lighting]",
    "Soft daylight",
  ].join("\n");

  const retry1 = jitterPoseSectionOrderForRetry(prompt, 1);
  assert.equal(retry1.strategy, "pose-first");
  assert.match(retry1.prompt, /^\[pose\]\n05 무릎 앉은 포즈/);
  assert.match(retry1.prompt, /\[character\]\nHero design/);

  const retry2 = jitterPoseSectionOrderForRetry(prompt, 2);
  assert.equal(retry2.strategy, "pose-after-first-reversed");
  assert.match(retry2.prompt, /^\[character\]\nHero design/);
  assert.match(retry2.prompt, /\[pose\]\n05 무릎 앉은 포즈/);
});
