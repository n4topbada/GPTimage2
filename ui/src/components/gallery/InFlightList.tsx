import { useAppStore } from "../../store/useAppStore";

function truncate(s: string, max = 28) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

export function InFlightList() {
  const inFlight = useAppStore((s) => s.inFlight);

  const phaseLabels: Record<string, string> = {
    local: "대기중",
    requesting: "전송중",
    queued: "서버접수",
    streaming: "생성중",
    partial: "부분완료",
    decoding: "저장중",
    completed: "완료",
    error: "실패",
  };

  if (inFlight.length === 0) return null;

  return (
    <ul className="in-flight-list">
      {inFlight.map((f) => {
        const phase = f.phase ?? "local";
        const phaseLabel = phaseLabels[phase] ?? phase;
        return (
          <li key={f.id} className="in-flight-item" data-phase={phase}>
            <span className="in-flight-prompt">{truncate(f.prompt)}</span>
            <span className="in-flight-phase">{phaseLabel}</span>
            {f.terminal ? null : (
              <span className="in-flight-spinner" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
