import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import * as z from "zod";

type Method = (...args: never) => void;

type MethodArgs<F> = F extends (...args: infer A) => void ? A : never;

export type ArgumentSchemas<Api> = {
  [K in keyof Api]: z.ZodType<MethodArgs<Api[K]>>;
};

/**
 * Binds one module's IPC contract to `ipcMain`. Renderer input is untrusted, so every
 * channel parses its arguments with the module's zod schemas before reaching a handler.
 */
export function ipcModule<Api extends Record<keyof Api, Method>>(
  channels: Record<keyof Api, string>,
  schemas: ArgumentSchemas<Api>
) {
  return function handle<K extends keyof Api>(
    name: K,
    // The invoking event comes last, for handlers that need to know which window asked.
    handler: (
      ...args: [...MethodArgs<Api[K]>, IpcMainInvokeEvent]
    ) => ReturnType<Api[K]>
  ) {
    const schema: z.ZodType<MethodArgs<Api[K]>> = schemas[name];

    ipcMain.handle(channels[name], (event, ...args) => {
      const parsed = schema.safeParse(args);

      // The issues' own JSON is unreadable once it reaches the renderer's error message.
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for ${channels[name]}: ${z.prettifyError(parsed.error)}`
        );
      }

      return handler(...parsed.data, event);
    });
  };
}
