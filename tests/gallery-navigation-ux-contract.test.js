import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("gallery navigation UX contract", () => {
  it("navigates focused generated images with arrow keys only on the viewer itself", () => {
    const canvas = readSource("ui/src/components/result/Canvas.tsx");
    const domEvents = readSource("ui/src/lib/domEvents.ts");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");
    const css = readSource("ui/src/index.css");

    assert.match(canvas, /isEditableTarget/);
    assert.match(canvas, /selectHistoryShortcutTarget/);
    assert.doesNotMatch(canvas, /selectImage/);
    assert.match(canvas, /event\.key !== "ArrowLeft"/);
    assert.match(canvas, /event\.key !== "Home"/);
    assert.match(canvas, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
    assert.match(canvas, /event\.shiftKey/);
    assert.match(canvas, /permanentlyDeleteHistoryItemByShortcut\(currentImage\)/);
    assert.match(canvas, /trashHistoryItem\(currentImage\)/);
    assert.match(canvas, /event\.target !== event\.currentTarget/);
    assert.match(canvas, /tabIndex=\{0\}/);
    assert.match(canvas, /onKeyDown=\{handleViewerKeyDown\}/);
    assert.match(canvas, /className="result-container visible"/);
    assert.match(canvas, /aria-label=\{t\("canvas\.imageViewerAria"\)\}/);
    assert.match(domEvents, /HTMLInputElement/);
    assert.match(domEvents, /HTMLTextAreaElement/);
    assert.match(domEvents, /HTMLSelectElement/);
    assert.match(domEvents, /HTMLButtonElement/);
    assert.match(domEvents, /isContentEditable/);
    assert.match(css, /\.result-container:focus-visible/);
    assert.match(ko, /imageViewerAria/);
    assert.match(en, /imageViewerAria/);
  });

  it("restores Gallery position by selected item with scrollTop fallback", () => {
    const gallery = readSource("ui/src/components/gallery/GalleryModal.tsx");
    const imageTile = readSource("ui/src/components/gallery/GalleryImageTile.tsx");
    const navigation = readSource("ui/src/lib/galleryNavigation.ts");
    const lineCount = gallery.split("\n").length;

    assert.ok(lineCount < 550, `GalleryModal.tsx should stay under 550 lines, got ${lineCount}`);
    assert.match(gallery, /useLayoutEffect/);
    assert.match(gallery, /useRef/);
    assert.match(gallery, /scrollRef/);
    assert.match(gallery, /itemRefs/);
    assert.match(gallery, /Record<string, HTMLElement \| null>/);
    assert.match(gallery, /lastScrollTopRef/);
    assert.match(gallery, /getGalleryItemKey/);
    assert.match(gallery, /scrollIntoView\(\{ block: "center" \}\)/);
    assert.match(gallery, /lastScrollTopRef\.current/);
    assert.match(gallery, /totalVisible/);
    assert.match(gallery, /visibleSessionGroups\.length/);
    assert.match(gallery, /visibleLoose\.length/);
    assert.match(gallery, /dateGroups\.length/);
    assert.match(gallery, /GalleryImageTile/);
    assert.match(imageTile, /itemRef: \(node: HTMLElement \| null\) => void/);
    assert.match(imageTile, /onSelect: \(item: GenerateItem\) => void/);
    assert.match(navigation, /export function getGalleryItemKey/);
  });

  it("keeps canvas versions internal instead of showing them in gallery surfaces", () => {
    const gallery = readSource("ui/src/components/gallery/GalleryModal.tsx");
    const historyStrip = readSource("ui/src/components/gallery/HistoryStrip.tsx");

    assert.match(gallery, /function isGalleryVisibleItem\(item: \{ canvasVersion\?: boolean; kind\?: string \| null \}\): boolean/);
    assert.match(gallery, /return !item\.canvasVersion && item\.kind !== "card-news-set" && item\.kind !== "card-news-card"/);
    assert.match(gallery, /const galleryHistory = useMemo\(\(\) => history\.filter\(isGalleryVisibleItem\), \[history\]\)/);
    assert.match(gallery, /galleryHistory\.filter/);
    assert.match(gallery, /s\.items\.filter\(isGalleryVisibleItem\)\.map\(toItem\)/);
    assert.match(gallery, /page\.loose\.filter\(isGalleryVisibleItem\)\.map\(toItem\)/);
    assert.match(gallery, /galleryHistory\.length === 0/);
    assert.match(historyStrip, /const visibleHistory = useMemo\(/);
    assert.match(historyStrip, /!item\.canvasVersion/);
    assert.match(historyStrip, /inFlightRequestIds/);
    assert.match(historyStrip, /visibleHistory\.map/);
  });

  it("maps vertical wheel input to horizontal thumbnail scrolling safely", () => {
    const wheel = readSource("ui/src/lib/horizontalWheel.ts");
    const historyStrip = readSource("ui/src/components/gallery/HistoryStrip.tsx");
    const cardDeck = readSource("ui/src/components/card-news/CardDeckRail.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(wheel, /scrollWidth <= el\.clientWidth/);
    assert.match(wheel, /Math\.abs\(event\.deltaY\) > Math\.abs\(event\.deltaX\)/);
    assert.match(wheel, /atStart/);
    assert.match(wheel, /atEnd/);
    assert.match(wheel, /preventDefault\(\)/);
    assert.match(wheel, /scrollLeft \+= event\.deltaY/);
    assert.match(historyStrip, /onWheel=\{handleHorizontalWheel\}/);
    assert.match(cardDeck, /onWheel=\{handleHorizontalWheel\}/);
    assert.match(css, /\.history-strip[\s\S]*overscroll-behavior-inline: contain/);
    assert.match(css, /\.card-news-deck[\s\S]*overscroll-behavior-inline: contain/);
  });

  it("renders the unified gallery and queue rail with prompt controls in the right panel", () => {
    const app = readSource("ui/src/App.tsx");
    const rightPanel = readSource("ui/src/components/layout/RightPanel.tsx");
    const historyStrip = readSource("ui/src/components/gallery/HistoryStrip.tsx");
    const css = readSource("ui/src/index.css");
    const appRule = /\.app\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const rightPanelRule =
      [...css.matchAll(/^\.right-panel\s*\{[^}]*\}/gm)].find((match) =>
        match[0].includes("height: 100dvh"),
      )?.[0] ?? "";
    const historyRule =
      [...css.matchAll(/\.history-strip\s*\{[^}]*\}/gs)].find((match) =>
        match[0].includes("flex-direction: column"),
      )?.[0] ?? "";
    const addRule = /\.history-thumb--add\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const queueRule = /\.history-thumb--queue\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const queueActiveRule = /\.history-thumb--queue-streaming,[\s\S]*?\.history-thumb--queue-decoding\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const queueErrorRule = /\.history-thumb--queue-error\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const responsiveBlock = /@media \(max-width:\s*800px\)\s*\{[\s\S]*?\.canvas\s*\{/s.exec(css)?.[0] ?? "";

    assert.match(app, /import \{ HistoryStrip \} from "\.\/components\/gallery\/HistoryStrip"/);
    assert.match(app, /data-history-strip-layout=\{historyStripLayout\}/);
    assert.match(app, /import \{ MobileAppBar \} from "\.\/components\/layout\/MobileAppBar"/);
    assert.doesNotMatch(app, /import \{ Sidebar \}/);
    assert.match(app, /<MobileAppBar \/>\s*<HistoryStrip \/>/);

    assert.match(rightPanel, /PromptComposer/);
    assert.match(readSource("ui/src/components/prompt/PromptComposer.tsx"), /GenerateButton/);
    assert.match(rightPanel, /ImageModelSelect/);
    assert.match(rightPanel, /SettingsButton/);
    assert.match(rightPanel, /right-panel-workspace/);

    assert.match(appRule, /--gallery-rail-w:\s*clamp\(72px,\s*6vw,\s*104px\)/);
    assert.match(appRule, /grid-template-columns:\s*var\(--gallery-rail-w\) minmax\(0,\s*1fr\) auto/);
    assert.match(rightPanelRule, /width:\s*var\(--right-panel-w\)/);
    assert.match(historyRule, /flex-direction:\s*column/);
    assert.match(historyRule, /overflow-y:\s*auto/);
    assert.match(historyRule, /overflow-x:\s*hidden/);
    assert.match(addRule, /top:\s*0/);
    assert.match(queueRule, /position:\s*relative/);
    assert.match(queueRule, /var\(--text-dim\)/);
    assert.match(queueActiveRule, /var\(--blue\)/);
    assert.match(queueActiveRule, /queue-active-pulse/);
    assert.match(queueErrorRule, /var\(--red\)/);
    assert.doesNotMatch(css, /progress-bar/);
    assert.doesNotMatch(readSource("ui/src/components/result/Canvas.tsx"), /activeGenerations/);
    assert.doesNotMatch(readSource("ui/src/components/canvas-mode/CanvasModeWorkspace.tsx"), /progress-bar/);

    assert.match(responsiveBlock, /grid-template-rows:\s*auto auto 1fr/);
    assert.match(responsiveBlock, /\.history-strip\s*\{[\s\S]*flex-direction:\s*row/);
    assert.match(responsiveBlock, /\.history-strip\s*\{[\s\S]*overflow-x:\s*auto/);
    assert.match(responsiveBlock, /\.history-thumb--add\s*\{[\s\S]*left:\s*0/);

    assert.match(historyStrip, /const \[failedImageKeys, setFailedImageKeys\] = useState<Set<string>>/);
    assert.match(historyStrip, /const inFlight = useAppStore\(\(s\) => s\.inFlight\)/);
    assert.match(historyStrip, /const failureLogs = useAppStore\(\(s\) => s\.failureLogs\)/);
    assert.match(historyStrip, /openFailureLog/);
    assert.match(historyStrip, /history-thumb--logs/);
    assert.match(historyStrip, /historyByRequestId/);
    assert.match(historyStrip, /history-thumb--queue/);
    assert.match(historyStrip, /history-thumb__skeleton/);
    assert.match(historyStrip, /function getHistoryItemKey\(item: GenerateItem\): string/);
    assert.match(historyStrip, /onError=\{\(\) =>/);
    assert.match(historyStrip, /onClick=\{\(\) => selectHistory\(item\)\}/);
  });

  it("does not introduce backend coupling for navigation UX", () => {
    const routes = readSource("routes/history.ts");
    const test = readSource("tests/gallery-navigation-ux-contract.test.js");

    assert.doesNotMatch(routes, /galleryNavigation/);
    assert.match(test, /does not introduce backend coupling/);
  });
});
