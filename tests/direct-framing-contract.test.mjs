import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildUserTextPrompt,
  GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
  GENERATE_DEVELOPER_PROMPT,
} from "../lib/oauthProxy.ts";

test("direct generate keeps reusable user prompt clean while developer framing stays available", () => {
  const textPrompt = buildUserTextPrompt("subtitle test", "direct", { webSearchEnabled: false });
  assert.match(textPrompt, /exact prompt, no modifications/);
  assert.match(textPrompt, /Do not translate, summarize, restyle, add clarifiers, or append boilerplate/);
  assert.doesNotMatch(textPrompt, /Required production framing/);
  assert.doesNotMatch(textPrompt, /professional fashion editorial \/ catalog photoshoot/);
  assert.match(GENERATE_NO_SEARCH_DEVELOPER_PROMPT, /professional creative tool/);
  assert.match(GENERATE_NO_SEARCH_DEVELOPER_PROMPT, /ordinary fashion, sport, beach, or editorial imagery/);
  assert.match(GENERATE_NO_SEARCH_DEVELOPER_PROMPT, /professional editorial and catalog shoot/);
  assert.match(GENERATE_NO_SEARCH_DEVELOPER_PROMPT, /Visible text:/);
  assert.match(GENERATE_DEVELOPER_PROMPT, /professional creative tool/);
});

test("generate route never drops developer framing on retries", () => {
  const route = readFileSync(join(process.cwd(), "routes", "generate.ts"), "utf8");
  assert.doesNotMatch(route, /dropDeveloperPrompt:\s*isFinalAttempt/);
  assert.match(route, /prompt_only_framing_kept/);
});
