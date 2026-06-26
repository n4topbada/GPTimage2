import { PromptComposer } from "../prompt/PromptComposer";
import { GenerateButton } from "../generation/GenerateButton";
import { InFlightList } from "../gallery/InFlightList";
import { SettingsButton } from "../settings/SettingsButton";
import { ImageModelSelect } from "../generation/ImageModelSelect";

export function SidebarStack() {
  return (
    <>
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
      <GenerateButton />
      <InFlightList />
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__scroll">
        <SidebarStack />
      </div>
    </aside>
  );
}
