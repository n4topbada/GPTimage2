import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import { handleHorizontalWheel } from "../../lib/horizontalWheel";
import type { GenerateItem } from "../../types";

const MAX_VISIBLE_STRIP_HISTORY = 160;

function getHistoryItemKey(item: GenerateItem): string {
  return item.filename ?? item.url ?? item.image;
}

function getHistoryImageSrc(item: GenerateItem): string | null {
  const src = item.thumb || item.url || item.image;
  return typeof src === "string" && src.length > 0 ? src : null;
}

function queuePhaseLabel(phase?: string): string {
  switch (phase) {
    case "local":
      return "대기중";
    case "requesting":
      return "전송중";
    case "queued":
      return "서버접수";
    case "streaming":
      return "생성중";
    case "partial":
      return "부분완료";
    case "decoding":
      return "저장중";
    case "completed":
      return "완료";
    case "error":
      return "실패";
    default:
      return phase || "대기중";
  }
}

export function HistoryStrip() {
  const history = useAppStore((s) => s.history);
  const inFlight = useAppStore((s) => s.inFlight);
  const failureLogs = useAppStore((s) => s.failureLogs);
  const currentImage = useAppStore((s) => s.currentImage);
  const historyStripLayout = useAppStore((s) => s.historyStripLayout);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const openGallery = useAppStore((s) => s.openGallery);
  const openFailureLog = useAppStore((s) => s.openFailureLog);
  const { t } = useI18n();
  const [failedImageKeys, setFailedImageKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const activeKey = currentImage ? getHistoryItemKey(currentImage) : null;
  const inFlightRequestIds = useMemo(
    () => new Set(inFlight.map((f) => f.id)),
    [inFlight],
  );
  const visibleHistory = useMemo(
    () =>
      history
        .filter(
          (item) =>
            !item.canvasVersion &&
            !(item.requestId && inFlightRequestIds.has(item.requestId)) &&
            Boolean(getHistoryImageSrc(item)) &&
            !failedImageKeys.has(getHistoryItemKey(item)),
        )
        .slice(0, MAX_VISIBLE_STRIP_HISTORY),
    [failedImageKeys, history, inFlightRequestIds],
  );
  const historyByRequestId = useMemo(() => {
    const map = new Map<string, GenerateItem>();
    for (const item of history) {
      if (item.requestId && !item.canvasVersion) map.set(item.requestId, item);
    }
    return map;
  }, [history]);

  return (
    <div
      className={`history-strip${
        historyStripLayout === "horizontal" ? " history-strip--horizontal" : ""
      }${historyStripLayout === "sidebar" ? " history-strip--sidebar" : ""}`}
      onWheel={handleHorizontalWheel}
      data-layout={historyStripLayout}
    >
      <button
        type="button"
        className="history-thumb history-thumb--add"
        onClick={openGallery}
        aria-label={t("history.openGalleryAria")}
        title={t("history.openGalleryTitle")}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        className="history-thumb history-thumb--logs"
        onClick={openFailureLog}
        aria-label={t("failureLog.openAria")}
        title={t("failureLog.openTitle")}
      >
        <span>LOG</span>
        {failureLogs.length > 0 ? (
          <b aria-label={t("failureLog.count", { count: failureLogs.length })}>
            {Math.min(99, failureLogs.length)}
          </b>
        ) : null}
      </button>
      {inFlight.map((job) => {
        const item = historyByRequestId.get(job.id);
        const phase = job.phase ?? "local";
        const phaseLabel = queuePhaseLabel(phase);
        const imageSrc = item ? getHistoryImageSrc(item) : null;
        const itemKey = item ? getHistoryItemKey(item) : null;
        const imageAvailable =
          item && imageSrc && itemKey && !failedImageKeys.has(itemKey);
        const active = itemKey ? activeKey === itemKey : false;
        return imageAvailable ? (
          <img
            key={`queue-${job.id}`}
            src={imageSrc}
            alt=""
            className={`history-thumb history-thumb--queue history-thumb--queue-${phase}${active ? " active" : ""}`}
            data-phase={phase}
            data-phase-label={phaseLabel}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (!itemKey) return;
              setFailedImageKeys((prev) => {
                const next = new Set(prev);
                next.add(itemKey);
                return next;
              });
            }}
            onClick={() => selectHistory(item)}
          />
        ) : (
          <button
            key={`queue-${job.id}`}
            type="button"
            className={`history-thumb history-thumb--queue history-thumb--queue-${phase}`}
            data-phase={phase}
            data-phase-label={phaseLabel}
            title={job.prompt}
            aria-label={t("inflight.queued")}
          >
            <span className="history-thumb__skeleton" aria-hidden="true" />
          </button>
        );
      })}
      {visibleHistory.map((item, i) => {
        const key = getHistoryItemKey(item);
        const imageSrc = getHistoryImageSrc(item);
        if (!imageSrc) return null;
        const active = activeKey === key;
        return (
          <img
            key={item.filename ?? `${i}-${item.image}`}
            src={imageSrc}
            alt=""
            className={`history-thumb${active ? " active" : ""}`}
            loading="lazy"
            decoding="async"
            onError={() => {
              setFailedImageKeys((prev) => {
                const next = new Set(prev);
                next.add(key);
                return next;
              });
            }}
            onClick={() => selectHistory(item)}
          />
        );
      })}
    </div>
  );
}
