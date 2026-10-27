import { expect, test } from "vite-plus/test";

import { SettingsSection } from "@solyx/api/settings-section";

import {
  FOOT_SECTIONS,
  GROUP_SECTIONS,
  SettingsGroup,
  TOP_SECTIONS,
  sectionGroup,
} from "../src/modules/settings/settings-groups.ts";

test("the sidebar lists every section once, above, in or below the groups", () => {
  expect(
    [
      ...TOP_SECTIONS,
      ...Object.values(GROUP_SECTIONS).flat(),
      ...FOOT_SECTIONS,
    ].toSorted()
  ).toEqual(Object.values(SettingsSection).toSorted());
});

test("a section opens the group it is listed under", () => {
  expect(sectionGroup(SettingsSection.CodeExecution)).toBe(
    SettingsGroup.Security
  );
  expect(sectionGroup(SettingsSection.General)).toBeUndefined();
});
