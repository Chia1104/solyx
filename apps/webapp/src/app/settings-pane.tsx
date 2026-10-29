import { SettingsNav } from "../modules/settings/settings-nav.tsx";

/** The settings page's sections, which take the listings' place in the symbols pane while it is open. */
export function SettingsPane() {
  return (
    <div className="h-full overflow-y-auto">
      <SettingsNav />
    </div>
  );
}
