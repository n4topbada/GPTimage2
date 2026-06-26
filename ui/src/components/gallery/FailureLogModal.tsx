import { useMemo, useState } from "react";
import { useAppStore, type GenerationFailureLog } from "../../store/useAppStore";
import { useI18n } from "../../i18n";

function formatTime(value: number): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function buildDetails(log: GenerationFailureLog): string {
  return JSON.stringify(
    {
      requestId: log.id,
      case: classifyFailure(log),
      kind: log.kind,
      phase: log.phase,
      httpStatus: log.httpStatus,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      errorDetails: log.errorDetails ?? null,
      startedAt: new Date(log.startedAt).toISOString(),
      finishedAt: new Date(log.finishedAt).toISOString(),
      durationMs: log.durationMs,
      meta: log.meta ?? null,
      prompt: log.prompt,
    },
    null,
    2,
  );
}

function buildUpstreamDebug(log: GenerationFailureLog): string | null {
  const debug = log.errorDetails?.upstreamDebug;
  if (!debug) return null;
  return JSON.stringify(debug, null, 2);
}

function buildRawSse(log: GenerationFailureLog): string | null {
  const debug = log.errorDetails?.upstreamDebug as
    | { rawSseBlocks?: unknown }
    | undefined;
  const blocks = debug?.rawSseBlocks;
  if (!Array.isArray(blocks)) return null;
  const raw = blocks.filter((block): block is string => typeof block === "string");
  if (raw.length === 0) return null;
  return raw.join("\n\n");
}

function classifyFailure(log: GenerationFailureLog): string {
  const code = String(log.errorCode || log.errorDetails?.code || "").toUpperCase();
  const status = Number(log.httpStatus);
  const message = String(log.errorMessage || log.errorDetails?.error || "").toLowerCase();
  if (code === "SAFETY_REFUSAL" || code === "MODERATION_REFUSED") {
    return "safety";
  }
  if (code === "INVALID_REQUEST" || (status >= 400 && status < 500 && status !== 401 && status !== 422)) {
    return "request";
  }
  if (code.includes("AUTH") || status === 401) return "auth";
  if (code === "EMPTY_RESPONSE" || message.includes("no image data")) {
    return "empty";
  }
  if (code === "IMAGE_TOOL_FAILED") return "upstream";
  if (code.includes("NETWORK") || code.includes("UNAVAILABLE")) return "network";
  if (status >= 500 || code.includes("UPSTREAM")) return "upstream";
  return "unknown";
}

function exportLogs(logs: GenerationFailureLog[]): string {
  return JSON.stringify(
    logs.map((log) => ({
      requestId: log.id,
      case: classifyFailure(log),
      phase: log.phase,
      httpStatus: log.httpStatus,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      errorDetails: log.errorDetails ?? null,
      prompt: log.prompt,
      startedAt: new Date(log.startedAt).toISOString(),
      finishedAt: new Date(log.finishedAt).toISOString(),
      durationMs: log.durationMs,
      kind: log.kind,
      meta: log.meta ?? null,
    })),
    null,
    2,
  );
}

export function FailureLogModal() {
  const open = useAppStore((s) => s.failureLogOpen);
  const logs = useAppStore((s) => s.failureLogs);
  const close = useAppStore((s) => s.closeFailureLog);
  const clear = useAppStore((s) => s.clearFailureLogs);
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const visibleLogs = useMemo(
    () => [...logs].sort((a, b) => b.finishedAt - a.finishedAt),
    [logs],
  );
  const caseCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of visibleLogs) {
      const key = classifyFailure(log);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [visibleLogs]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(exportLogs(visibleLogs));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop failure-log-backdrop" role="presentation">
      <section
        className="modal failure-log-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="failure-log-title"
      >
        <header className="failure-log-modal__header">
          <div>
            <div id="failure-log-title" className="modal__title">
              {t("failureLog.title")}
            </div>
            <p>{t("failureLog.subtitle", { count: visibleLogs.length })}</p>
          </div>
          <button
            type="button"
            className="failure-log-modal__close"
            onClick={close}
            aria-label={t("common.close")}
          >
            X
          </button>
        </header>

        <div className="failure-log-modal__body">
          {visibleLogs.length === 0 ? (
            <div className="failure-log-modal__empty">
              {t("failureLog.empty")}
            </div>
          ) : (
            <>
              <div className="failure-log-modal__cases">
                {caseCounts.map(([caseId, count]) => (
                  <span key={caseId}>
                    {t(`failureLog.case.${caseId}`)} <b>{count}</b>
                  </span>
                ))}
              </div>
              {visibleLogs.map((log) => {
                const caseId = classifyFailure(log);
                const upstreamDebug = buildUpstreamDebug(log);
                const rawSse = buildRawSse(log);
                return (
                  <article key={log.id} className="failure-log-modal__item">
                    <div className="failure-log-modal__summary">
                      <strong>{log.errorCode ?? t("failureLog.unknownCode")}</strong>
                      <em>{t(`failureLog.case.${caseId}`)}</em>
                      <span>{formatTime(log.finishedAt)}</span>
                      {typeof log.httpStatus === "number" ? (
                        <code>HTTP {log.httpStatus}</code>
                      ) : null}
                    </div>
                    {log.errorMessage ? (
                      <p className="failure-log-modal__message">
                        {log.errorMessage}
                      </p>
                    ) : null}
                    {log.prompt ? (
                      <details className="failure-log-modal__prompt-details">
                        <summary>{t("failureLog.prompt")}</summary>
                        <p className="failure-log-modal__prompt">{log.prompt}</p>
                      </details>
                    ) : null}
                    {upstreamDebug ? (
                      <details>
                        <summary>GPT API 응답</summary>
                        <pre>{upstreamDebug}</pre>
                      </details>
                    ) : null}
                    {rawSse ? (
                      <details>
                        <summary>Raw SSE</summary>
                        <pre>{rawSse}</pre>
                      </details>
                    ) : null}
                    <details>
                      <summary>{t("failureLog.details")}</summary>
                      <pre>{buildDetails(log)}</pre>
                    </details>
                  </article>
                );
              })}
            </>
          )}
        </div>

        <footer className="modal__actions">
          <button
            type="button"
            className="modal__btn modal__btn--secondary"
            onClick={copyLogs}
            disabled={visibleLogs.length === 0}
          >
            {copied ? t("failureLog.copied") : t("failureLog.copyJson")}
          </button>
          <button
            type="button"
            className="modal__btn modal__btn--secondary"
            onClick={clear}
            disabled={visibleLogs.length === 0}
          >
            {t("failureLog.clear")}
          </button>
          <button type="button" className="modal__btn" onClick={close}>
            {t("common.close")}
          </button>
        </footer>
      </section>
    </div>
  );
}
