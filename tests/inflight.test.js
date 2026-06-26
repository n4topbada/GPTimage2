import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-inflight-test-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const {
  _resetForTests,
  expireOverdueJobs,
  finishJob,
  listJobs,
  listTerminalJobs,
  setJobPhase,
  startJob,
} = await import("../lib/inflight");
const { closeDb } = await import("../lib/db");

beforeEach(() => {
  _resetForTests();
});

after(() => {
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("finishJob moves active jobs into terminal history without polluting active list", () => {
  startJob({
    requestId: "req_active",
    kind: "node",
    prompt: "private prompt",
    meta: { sessionId: "s_1", clientNodeId: "nc_1" },
  });
  setJobPhase("req_active", "streaming");

  assert.equal(listJobs({ kind: "node", sessionId: "s_1" }).length, 1);
  finishJob("req_active", {
    status: "completed",
    httpStatus: 200,
    meta: { nodeId: "n_1" },
  });

  assert.equal(listJobs({ kind: "node", sessionId: "s_1" }).length, 0);
  const terminal = listTerminalJobs({ kind: "node", sessionId: "s_1" });
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].requestId, "req_active");
  assert.equal(terminal[0].status, "completed");
  assert.equal(terminal[0].httpStatus, 200);
  assert.equal(terminal[0].meta.nodeId, "n_1");
  assert.equal(terminal[0].prompt, undefined);
});

test("finishJob records canceled status for explicit cancellation", () => {
  startJob({
    requestId: "req_cancel",
    kind: "classic",
    prompt: "private prompt",
    meta: {},
  });
  finishJob("req_cancel", { canceled: true });

  const terminal = listTerminalJobs({ kind: "classic" });
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, "canceled");
});

test("active jobs expose reference diagnostics in metadata", () => {
  startJob({
    requestId: "req_refs",
    kind: "classic",
    prompt: "private prompt",
    meta: { refsCount: 1, referenceBytes: 1234, referenceB64Chars: 1648 },
  });

  const [job] = listJobs({ kind: "classic" });
  assert.equal(job.meta.refsCount, 1);
  assert.equal(job.meta.referenceBytes, 1234);
  assert.equal(job.meta.referenceB64Chars, 1648);
});

test("overdue active jobs expire as timeout terminal errors", () => {
  const realNow = Date.now;
  const startedAt = 1_781_500_000_000;
  try {
    Date.now = () => startedAt;
    startJob({
      requestId: "req_timeout",
      kind: "classic",
      prompt: "private prompt",
      meta: { size: "2352x3520", model: "gpt-5.4-mini" },
    });
    setJobPhase("req_timeout", "streaming");

    Date.now = () => startedAt + 300_001;
    expireOverdueJobs();

    assert.equal(listJobs({ kind: "classic" }).length, 0);
    const terminal = listTerminalJobs({ kind: "classic" });
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].requestId, "req_timeout");
    assert.equal(terminal[0].status, "error");
    assert.equal(terminal[0].httpStatus, 504);
    assert.equal(terminal[0].errorCode, "OAUTH_IMAGE_TIMEOUT");
    assert.equal(terminal[0].meta.errorDetails.expiredByInflightReaper, true);
  } finally {
    Date.now = realNow;
  }
});

test("terminal jobs remain observable across a reload-debug window", () => {
  const realNow = Date.now;
  const startedAt = 1_777_400_000_000;
  try {
    Date.now = () => startedAt;
    startJob({
      requestId: "req_terminal_window",
      kind: "classic",
      prompt: "private prompt",
      meta: {},
    });
    setJobPhase("req_terminal_window", "streaming");

    Date.now = () => startedAt + 10_000;
    finishJob("req_terminal_window", {
      status: "completed",
      httpStatus: 200,
    });

    Date.now = () => startedAt + 70_000;
    assert.equal(listTerminalJobs({ kind: "classic" }).length, 1);

    Date.now = () => startedAt + 10_000 + 5 * 60 * 1000 + 1;
    assert.equal(listTerminalJobs({ kind: "classic" }).length, 0);
  } finally {
    Date.now = realNow;
  }
});
