import { Button } from "@heroui/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { ColumnHeader } from "../components/column-header.tsx";
import { Icon } from "../components/icon.tsx";
import { SettingsNav } from "../modules/settings/settings-nav.tsx";

/** The settings page's sections, which take the listings' place in the symbols pane while it is open. */
export function SettingsPane({ onLeave }: { onLeave: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <ColumnHeader>
        {/* Pulled out by its padding, so its arrow sits over the sections' icons. */}
        <Button size="sm" variant="ghost" className="-ml-2.5" onPress={onLeave}>
          <Icon icon={ArrowLeft01Icon} />
          {t("nav.back")}
        </Button>
      </ColumnHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsNav />
      </div>
    </div>
  );
}
