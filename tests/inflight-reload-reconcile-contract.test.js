import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

test("store boot does not render persisted in-flight jobs before server reconcile", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /activeGenerations:\s*0,/);
  assert.match(store, /inFlight:\s*\[\],/);
  assert.doesNotMatch(store, /activeGenerations:\s*loadInFlight\(\)\.length/);
  assert.doesNotMatch(store, /inFlight:\s*loadInFlight\(\),/);
});

test("first in-flight reconciliation still uses persisted local request IDs", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(
    store,
    /const currentLocal = get\(\)\.inFlight;\s*const local = currentLocal\.length > 0 \? currentLocal : loadInFlight\(\);/,
  );
});

test("polling restores server-only active jobs after terminal cleanup", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /const localIds = new Set\(merged\.map\(\(f\) => f\.id\)\);/);
  assert.match(store, /for \(const j of jobs\) \{\s*if \(!localIds\.has\(j\.requestId\)\) \{\s*merged\.push\(toPersistedInFlightJob\(j\)\);/);
});

test("polling TTL prune keeps server-active jobs even after local TTL expires", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /let scopedActiveServerIds = new Set<string>\(\);/);
  assert.match(store, /scopedActiveServerIds = new Set\(jobs\.map\(\(j\) => j\.requestId\)\);/);
  assert.match(store, /scopedActiveServerIds\.has\(f\.id\)/);
  assert.match(store, /isClientGenerationPending\(f\.id\)/);
  assert.match(store, /now - f\.startedAt < INFLIGHT_TTL_MS/);
});

test("terminal in-flight queue entries expire after a short display window", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /const TERMINAL_INFLIGHT_DISPLAY_MS = 60_000;/);
  assert.match(store, /function isInFlightVisible\(job: PersistedInFlight, now = Date\.now\(\)\): boolean/);
  assert.match(store, /now - finishedAt < TERMINAL_INFLIGHT_DISPLAY_MS/);
  assert.match(store, /function pruneInFlight\(list: PersistedInFlight\[\], now = Date\.now\(\)\): PersistedInFlight\[\]/);
  assert.match(store, /function pruneTerminalInFlight\(list: PersistedInFlight\[\], now = Date\.now\(\)\): PersistedInFlight\[\]/);
  assert.match(store, /return list\.filter\(\(f\) => !f\.terminal \|\| isInFlightVisible\(f, now\)\);/);
  assert.match(store, /const cur = pruneTerminalInFlight\(get\(\)\.inFlight\);/);
  assert.match(store, /const hasActiveInFlight = countActiveInFlight\(cur\) > 0;/);
  assert.match(store, /if \(hasActiveInFlight\) try \{/);
  assert.doesNotMatch(store, /if \(countActiveInFlight\(cur\) === 0\) return;/);
});

test("polling does not drop server-unregistered local queued jobs after a short grace", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.doesNotMatch(store, /const GRACE_MS = 5000/);
  assert.doesNotMatch(store, /now0 - f\.startedAt > GRACE_MS/);
  assert.match(store, /SERVER_MISSING_INFLIGHT_GRACE_MS/);
  assert.match(store, /const clientGenerationPendingIds = new Set<string>\(\);/);
  assert.match(store, /function isClientGenerationPending\(id: string\): boolean/);
  assert.match(store, /isClientGenerationPending\(f\.id\)/);
  assert.match(store, /now - f\.startedAt < SERVER_MISSING_INFLIGHT_GRACE_MS/);
});

test("server-missing stale local jobs are pruned without replaying failure logs", () => {
  const store = readSource("ui/src/store/useAppStore.ts");

  assert.match(store, /local\/server reconciliation miss, not a generation/);
  assert.match(store, /persistent error log every time localStorage is rehydrated/);
  assert.match(store, /function isStaleInflightRecord/);
  assert.match(store, /!isStaleInflightRecord\(x\)/);
  assert.match(store, /if \(isStaleInflightRecord\(x\)\) return null/);
  assert.match(store, /!isStaleInflightRecord\(f\)/);
  assert.doesNotMatch(store, /errorCode:\s*"STALE_INFLIGHT"[\s\S]{0,600}recordFailureLog/);
  assert.doesNotMatch(store, /Generation request is no longer active on the server/);
});

test("app reconciles in-flight state on mount after reload", () => {
  const app = readSource("ui/src/App.tsx");

  assert.match(app, /reconcileInflight\(\);/);
  assert.match(app, /startInFlightPolling\(\);/);
});
