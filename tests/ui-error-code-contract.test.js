import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("UI maps proxy and network errors to card surfaces", () => {
  const source = readFileSync("ui/src/lib/errorCodes.ts", "utf-8");
  assert.match(source, /NETWORK_FAILED:\s*\{ surface: "card", cardKey: "errorCard\.networkFailed"/);
  assert.match(source, /OAUTH_UNAVAILABLE:\s*\{ surface: "card", cardKey: "errorCard\.oauthUnavailable"/);
  assert.match(source, /INVALID_REQUEST:\s*\{ surface: "card", cardKey: "errorCard\.invalidRequest"/);
  assert.match(source, /EMPTY_RESPONSE:\s*\{ surface: "card", cardKey: "errorCard\.emptyResponse"/);
  assert.match(source, /invalid_value/);
  assert.match(source, /minimum pixel budget/);
  assert.doesNotMatch(source, /content generation refused[^}]+MODERATION_REFUSED/s);
});

test("UI keeps terminal generation errors in the queue instead of opening a popup", () => {
  const store = readFileSync("ui/src/store/useAppStore.ts", "utf-8");
  const api = readFileSync("ui/src/lib/api.ts", "utf-8");
  const list = readFileSync("ui/src/components/gallery/InFlightList.tsx", "utf-8");

  assert.match(api, /No image data returned from the multimode stream/);
  assert.match(api, /e\.code = "EMPTY_RESPONSE"/);
  assert.match(store, /includeTerminal: true/);
  assert.match(store, /terminalToPersistedInFlight/);
  assert.match(store, /phase: isError \? "error" : "completed"/);
  assert.match(store, /recordFailureLog/);
  assert.match(store, /errorMessage/);
  assert.match(store, /nextInflight\.push\(terminalFlight\)/);
  assert.match(readFileSync("ui/src/components/gallery/FailureLogModal.tsx", "utf-8"), /failureLog\.title/);
  assert.doesNotMatch(store, /terminalErrors/);
  assert.doesNotMatch(store, /for \(const err of terminalErrors\)/);
  assert.match(list, /completed:\s*".*"/);
  assert.match(list, /error:\s*".*"/);
  assert.match(list, /f\.terminal \? null/);
  assert.doesNotMatch(store, /if \(cur\.length === 0\) \{\s*await get\(\)\.reconcileInflight\(\);/);
});

test("classic generation reserves a browser connection for polling while batching", () => {
  const store = readFileSync("ui/src/store/useAppStore.ts", "utf-8");

  assert.match(store, /const MAX_CLIENT_GENERATION_POSTS = 5/);
  assert.match(store, /clientGenerationPostQueue/);
  assert.match(store, /withGenerationPostSlot/);
  assert.match(store, /return postGenerate\(\{/);
  assert.match(store, /return postEdit\(\{/);
  assert.match(store, /markFlightPhase\(requestId, "requesting"\)/);
});

test("invalid request and open-folder feedback i18n keys exist", () => {
  const en = readFileSync("ui/src/i18n/en.json", "utf-8");
  const ko = readFileSync("ui/src/i18n/ko.json", "utf-8");
  assert.match(en, /"openGeneratedDirOpened"/);
  assert.match(ko, /"openGeneratedDirOpened"/);
  assert.match(en, /"invalidRequest"/);
  assert.match(ko, /"invalidRequest"/);
  assert.match(en, /"emptyResponse"/);
  assert.match(ko, /"emptyResponse"/);
  assert.match(en, /"failureLog"/);
  assert.match(ko, /"failureLog"/);
});
