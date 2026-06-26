import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AUTO_PROMPT_FIDELITY_SUFFIX,
  DIRECT_PROMPT_FIDELITY_SUFFIX,
  EDIT_DEVELOPER_PROMPT,
  GENERATE_DEVELOPER_PROMPT,
  PROMPT_FIDELITY_SUFFIX,
  buildEditTextPrompt,
  buildUserTextPrompt,
} from "../lib/oauthProxy";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "server.ts");
const historyListPath = join(__dirname, "..", "lib", "historyList.ts");
const apiPath = join(__dirname, "..", "ui", "src", "lib", "api.ts");

const src = await readFile(serverPath, "utf8");
const historySrc = await readFile(historyListPath, "utf8");
const apiSrc = await readFile(apiPath, "utf8");

assert.ok(src.includes("buildApp"), "buildApp export missing after server split");
assert.ok(historySrc.includes("revisedPrompt"), "history revisedPrompt field missing");
assert.ok(historySrc.includes("promptMode"), "history promptMode field missing");
assert.ok(historySrc.includes("userPrompt"), "history userPrompt field missing");
assert.ok(historySrc.includes("refsCount"), "history refsCount field missing");
assert.ok(historySrc.includes("requestId"), "history requestId field missing");
assert.ok(apiSrc.includes("postGenerate"), "classic generate client missing");
assert.ok(apiSrc.includes("postEdit"), "classic edit client missing");

assert.equal(PROMPT_FIDELITY_SUFFIX, AUTO_PROMPT_FIDELITY_SUFFIX);
assert.ok(AUTO_PROMPT_FIDELITY_SUFFIX.includes("Treat the user's prompt as the source of truth"));
assert.ok(AUTO_PROMPT_FIDELITY_SUFFIX.includes("pass it through as the image_generation prompt argument"));
assert.ok(!AUTO_PROMPT_FIDELITY_SUFFIX.includes("only append English clarifiers at the end when helpful"));
assert.ok(!DIRECT_PROMPT_FIDELITY_SUFFIX.includes("append English clarifiers"));
assert.ok(DIRECT_PROMPT_FIDELITY_SUFFIX.includes("Do not translate, summarize, restyle, add clarifiers"));
assert.ok(!DIRECT_PROMPT_FIDELITY_SUFFIX.includes("Required production framing"));
assert.ok(!DIRECT_PROMPT_FIDELITY_SUFFIX.includes("professional fashion editorial / catalog photoshoot"));

const generateDirect = buildUserTextPrompt("고양이 수채화", "direct");
const generateAuto = buildUserTextPrompt("고양이 수채화", "auto");
assert.ok(generateDirect.includes("Generate an image with this exact prompt, no modifications"));
assert.ok(!generateDirect.includes("append English clarifiers"));
assert.ok(generateAuto.includes("Generate an image: 고양이 수채화"));
assert.ok(generateAuto.includes("If factual visual accuracy is required"));
assert.ok(generateAuto.includes("If the user's prompt is already visually sufficient"));
assert.ok(generateAuto.includes("pass the user's prompt through"));
assert.notEqual(generateDirect, generateAuto);

const editDirect = buildEditTextPrompt("change background", "direct");
const editAuto = buildEditTextPrompt("change background", "auto");
assert.ok(editDirect.includes("Edit this image with this exact prompt, no modifications"));
assert.ok(!editDirect.includes("append English clarifiers"));
assert.ok(editAuto.includes("Edit this image: change background"));
assert.notEqual(editDirect, editAuto);

for (const prompt of [GENERATE_DEVELOPER_PROMPT, EDIT_DEVELOPER_PROMPT]) {
  assert.ok(prompt.includes("absolute quality"), "developer prompt should use neutral quality language");
  assert.ok(!prompt.includes("8k UHD"), "developer prompt should not force 8k/photo boilerplate");
  assert.ok(!prompt.includes("default to photorealistic"), "developer prompt should not force photorealism");
  assert.ok(prompt.includes("one concise web_search"), "real-person search should start at one concise call");
  assert.ok(!prompt.includes("AT LEAST 3"), "real-person search should not force 3+ calls");
  assert.ok(!prompt.includes("4-5"), "real-person search should not prefer 4-5 calls");
}
assert.ok(GENERATE_DEVELOPER_PROMPT.includes("when it is visually sufficient"), "generate prompt should pass through sufficient prompts");
assert.ok(EDIT_DEVELOPER_PROMPT.includes("Apply the user's requested edit precisely"), "edit prompt should prioritize the requested edit");

console.log("prompt-fidelity: ok");
