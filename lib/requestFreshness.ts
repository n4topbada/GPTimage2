const CLIENT_REQUEST_ID_RE = /^f_(\d+)(?:_|$)/;

export function isRequestQueuedBeforeServerBoot(requestId, serverStartedAt, graceMs = 1000) {
  const match = CLIENT_REQUEST_ID_RE.exec(String(requestId || ""));
  if (!match) return false;
  const clientQueuedAt = Number.parseInt(match[1], 10);
  const bootedAt = Number(serverStartedAt);
  if (!Number.isFinite(clientQueuedAt) || !Number.isFinite(bootedAt) || bootedAt <= 0) {
    return false;
  }
  return clientQueuedAt < bootedAt - Math.max(0, Number(graceMs) || 0);
}

export function staleClientQueuePayload(requestId) {
  return {
    error: "Generation request was queued before the current server boot and was discarded.",
    code: "STALE_CLIENT_QUEUE",
    requestId,
  };
}
