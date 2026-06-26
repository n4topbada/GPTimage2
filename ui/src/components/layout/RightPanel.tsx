import { lazy, Suspense, useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { PromptComposer } from "../prompt/PromptComposer";
import { SettingsButton } from "../settings/SettingsButton";
import { ImageModelSelect } from "../generation/ImageModelSelect";
import { SizePicker } from "../generation/SizePicker";
import { GenerationModePicker } from "../generation/GenerationModePicker";
import { useI18n } from "../../i18n";

const LazyPromptLibraryPanel = lazy(() =>
  import("../prompt/PromptLibraryPanel").then((module) => ({ default: module.PromptLibraryPanel })),
);

export function RightPanel() {
  const open = useAppStore((s) => s.rightPanelOpen);
  const toggle = useAppStore((s) => s.toggleRightPanel);
  const { t } = useI18n();
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 800px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 800px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const drawerOpen = isMobile ? open : true;

  return (
    <>
      {isMobile && open ? (
        <div
          className="right-panel-backdrop"
          role="button"
          aria-label={t("panel.closeSettings")}
          onClick={toggle}
        />
      ) : null}
      <aside
        className={`right-panel${open ? "" : " collapsed"}${isMobile && drawerOpen ? " drawer-open" : ""}`}
        aria-label={t("panel.detailSettings")}
      >
        {/* Mobile toggle is rendered separately by <MobileSettingsToggle /> from App.tsx
            (HT-2: lifted out of the transformed <aside> to avoid Safari fixed-descendant bugs). */}
        {!isMobile && (
          <button
            type="button"
            className="right-panel-toggle"
            aria-expanded={open}
            aria-controls="right-panel-body"
            onClick={toggle}
            title={open ? t("panel.toggleHide") : t("panel.toggleShow")}
          >
            {open ? ">" : "<"}
          </button>
        )}
        <div
          id="right-panel-body"
          className="right-panel-body"
          hidden={!open}
        >
          <div className="right-panel-workspace">
            <div className="logo">
              <div className="logo-mark" aria-hidden="true" />
              <div className="logo-copy">
                <div className="logo-title">ima2-gen</div>
                <div className="logo-subtitle">gpt-image-2 studio</div>
              </div>
              <div className="logo-actions">
                <ImageModelSelect variant="sidebar" />
                <SettingsButton />
              </div>
            </div>
            <PromptComposer />
            <div className="right-panel-settings">
              <SizePicker />
              <GenerationModePicker />
            </div>
          </div>
          <div className="right-panel-library">
            <Suspense fallback={<div className="prompt-library-panel__loading">{t("common.loading")}</div>}>
              <LazyPromptLibraryPanel variant="embedded" />
            </Suspense>
          </div>
        </div>
      </aside>
    </>
  );
}
