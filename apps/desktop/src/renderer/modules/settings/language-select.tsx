import { Description, Label, ListBox, Select } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { Locale, changeLocale } from "../../app/i18n.ts";

export function LanguageSelect() {
  const { t, i18n } = useTranslation();

  return (
    <Select
      className="max-w-xs"
      value={i18n.language}
      onChange={(key) => {
        if (key !== null && isEnumValue(Locale, key)) {
          void changeLocale(key);
        }
      }}>
      <Label>{t("settings.language")}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Description>{t("settings.language-description")}</Description>
      <Select.Popover>
        <ListBox>
          {Object.values(Locale).map((locale) => (
            <ListBox.Item
              key={locale}
              id={locale}
              textValue={t(`locale.${locale}`)}>
              {t(`locale.${locale}`)}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
