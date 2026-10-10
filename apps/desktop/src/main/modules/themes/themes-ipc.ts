import * as z from "zod";

import { themeDraftSchema } from "@solyx/core/theme";

import { themesChannels } from "#shared/ipc/themes.ts";
import type { ThemesApi } from "#shared/ipc/themes.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const id = z.string().min(1);

const schemas = {
  list: z.tuple([]),
  create: z.tuple([themeDraftSchema]),
  update: z.tuple([id, themeDraftSchema]),
  remove: z.tuple([id]),
  check: z.tuple([id]),
};

export function registerThemesIpc({ themes }: Services) {
  bindIpc<ThemesApi>(themesChannels, schemas, {
    list: async () => themes.desk.list(),
    create: async (draft) => void themes.desk.save(draft),
    update: async (themeId, draft) => themes.update(themeId, draft),
    remove: async (themeId) => themes.desk.remove(themeId),
    check: (themeId) => themes.check(themeId),
  });
}
