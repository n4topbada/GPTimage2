import { lazy, Suspense, useEffect } from "react";
import { Canvas } from "./components/result/Canvas";
import { RightPanel } from "./components/layout/RightPanel";
import { HistoryStrip } from "./components/gallery/HistoryStrip";
import { Toast } from "./components/feedback/Toast";
import { ErrorCard } from "./components/feedback/ErrorCard";
import { GalleryModal } from "./components/gallery/GalleryModal";
import { CustomSizeConfirmModal } from "./components/feedback/CustomSizeConfirmModal";
import { MetadataRestoreDialog } from "./components/feedback/MetadataRestoreDialog";
import { FailureLogModal } from "./components/gallery/FailureLogModal";
import { TrashUndoToast } from "./components/feedback/TrashUndoToast";
import { MobileSettingsToggle } from "./components/settings/MobileSettingsToggle";
import { MobileAppBar } from "./components/layout/MobileAppBar";
import { MobileComposeSheet } from "./components/layout/MobileComposeSheet";
import { useAppStore } from "./store/useAppStore";
import { useGalleryViewerNavigation } from "./hooks/useGalleryViewerNavigation";
import { useBrowserAttentionBadge } from "./hooks/useBrowserAttentionBadge";
import { useIsMobile } from "./hooks/useIsMobile";
import { useVisualViewportInset } from "./hooks/useVisualViewportInset";

const LazySettingsWorkspace = lazy(() =>
  import("./components/settings/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })),
);

function WorkspaceFallback() {
  return <main className="canvas canvas--lazy-loading" aria-busy="true" />;
}

export default function App() {
  useGalleryViewerNavigation();
  useVisualViewportInset();
  const hydrateHistory = useAppStore((s) => s.hydrateHistory);
  const startInFlightPolling = useAppStore((s) => s.startInFlightPolling);
  const reconcileInflight = useAppStore((s) => s.reconcileInflight);
  const syncFromStorage = useAppStore((s) => s.syncFromStorage);
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const themeFamily = useAppStore((s) => s.themeFamily);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const unseenGeneratedCount = useAppStore((s) => s.unseenGeneratedCount);
  const historyStripLayout = useAppStore((s) => s.historyStripLayout);
  const syncThemeFromStorage = useAppStore((s) => s.syncThemeFromStorage);
  const syncThemeFamilyFromStorage = useAppStore((s) => s.syncThemeFamilyFromStorage);
  const refreshResolvedTheme = useAppStore((s) => s.refreshResolvedTheme);
  const isMobile = useIsMobile();

  useBrowserAttentionBadge(unseenGeneratedCount);

  useEffect(() => {
    hydrateHistory();
    reconcileInflight();
    startInFlightPolling();
  }, [hydrateHistory, reconcileInflight, startInFlightPolling]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === "ima2.inFlight" ||
        e.key === "ima2.failureLogs" ||
        e.key === "ima2.selectedFilename"
      ) {
        syncFromStorage();
      } else if (e.key === "ima2:theme") {
        syncThemeFromStorage();
      } else if (e.key === "ima2:themeFamily") {
        syncThemeFamilyFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage, syncThemeFromStorage, syncThemeFamilyFromStorage]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themeMode = resolvedTheme;
    root.dataset.themeFamily = themeFamily;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, themeFamily]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", refreshResolvedTheme);
    return () => media.removeEventListener("change", refreshResolvedTheme);
  }, [refreshResolvedTheme, theme]);

  return (
    <>
      <div
        className={`app${settingsOpen ? " app--settings-open" : ""}`}
        data-theme-mode={resolvedTheme}
        data-theme-family={themeFamily}
        data-history-strip-layout={historyStripLayout}
        data-mobile={isMobile ? "1" : undefined}
        data-ui-mode="classic"
      >
        <MobileAppBar />
        <HistoryStrip />
        <Suspense fallback={<WorkspaceFallback />}>
          {settingsOpen ? <LazySettingsWorkspace /> : <Canvas />}
        </Suspense>
        <RightPanel />
      </div>
      <CustomSizeConfirmModal />
      <TrashUndoToast />
      <Toast />
      <ErrorCard />
      <GalleryModal />
      <MetadataRestoreDialog />
      <FailureLogModal />
      <MobileComposeSheet />
      <MobileSettingsToggle />
    </>
  );
}
