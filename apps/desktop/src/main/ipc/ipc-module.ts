import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import * as z from "zod";

type Method = (...args: never) => void;

type MethodArgs<F> = F extends (...args: infer A) => void ? A : never;

type MethodResult<F> = F extends (...args: never) => infer R ? R : never;

type ArgumentSchemas<Api> = {
  [K in keyof Api]: z.ZodType<MethodArgs<Api[K]>>;
};

/**
 * A module's handlers: its contract's methods, each also handed the invoking event last, which
 * only a handler that needs the asking window declares.
 */
export type IpcHandlers<Api> = {
  [K in keyof Api]: (
    ...args: [...MethodArgs<Api[K]>, IpcMainInvokeEvent]
  ) => MethodResult<Api[K]>;
};

/**
 * Binds every channel of one module's IPC contract to its handler. Renderer input is untrusted,
 * so every channel parses its arguments with the module's zod schemas before reaching a handler.
 */
export function bindIpc<Api extends Record<keyof Api, Method>>(
  channels: Record<keyof Api, string>,
  schemas: ArgumentSchemas<Api>,
  handlers: IpcHandlers<Api>
) {
  function bind<K extends keyof Api>(name: K) {
    const schema: z.ZodType<MethodArgs<Api[K]>> = schemas[name];
    const handler = handlers[name];

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
  }

  // SAFETY: a contract's channel map holds exactly its method names, which the
  // `satisfies Record<keyof Api, string>` beside its declaration checks.
  for (const name of Object.keys(channels) as (keyof Api)[]) bind(name);
}
