import kit from "./agent-canvas.css?inline";

import { useEffect, useMemo, useRef, useState } from "react";

import { kebabCase } from "es-toolkit";
import { useTranslation } from "react-i18next";
import { useIsCodeFenceIncomplete } from "streamdown";

import { Market } from "@solyx/core/market";

import { PaletteToken } from "#shared/palette.ts";

import { useColorScheme, usePaletteColors } from "../../app/theme.ts";
import { useDirectionColors } from "../market/price-colors.ts";

import { AgentLinkDialog } from "./agent-link-dialog.tsx";

// With no scripts in the sandbox and every request refused, a canvas shows only what it was written with.
const CANVAS_POLICY = "default-src 'none'; style-src 'unsafe-inline'";

/** A canvas's stylesheet: the palette and each market's rise and fall as the user sees them, as custom properties, then the kit's marks. */
function useCanvasStyle(): string {
  const scheme = useColorScheme();
  const colors = usePaletteColors();
  const tw = useDirectionColors(Market.TW);
  const us = useDirectionColors(Market.US);

  return useMemo(() => {
    const root = getComputedStyle(document.documentElement);

    const properties = [
      ...Object.values(PaletteToken).map((token) => [token, colors[token]]),
      ["twRise", tw.rise.solid],
      ["twFall", tw.fall.solid],
      ["usRise", us.rise.solid],
      ["usFall", us.fall.solid],
      ["radius", root.getPropertyValue("--radius")],
    ]
      .map(([token, value]) => `--${kebabCase(token)}: ${value};`)
      .join(" ");

    return `:root { color-scheme: ${scheme}; ${properties} } body { margin: 0; color: var(--foreground); font: 14px/1.5 ${getComputedStyle(document.body).fontFamily}; } ${kit}`;
  }, [scheme, colors, tw, us]);
}

function CanvasFrame({ html }: { html: string }) {
  const { t } = useTranslation();
  const style = useCanvasStyle();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  const [link, setLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    const element = frame.current;

    if (!element) return;

    let observer: ResizeObserver | undefined;

    // A link never navigates the frame; an https one asks before it opens in the browser.
    const onClick = (event: MouseEvent) => {
      const { target } = event;

      // SAFETY: the frame's nodes belong to its own realm, where `instanceof Element` fails here;
      // an event target with `closest` is an Element.
      const anchor =
        target && "closest" in target ? (target as Element).closest("a") : null;

      if (!anchor) return;

      event.preventDefault();

      if (anchor.href.startsWith("https://")) {
        setLink(anchor.href);
        setLinkOpen(true);
      }
    };

    const onLoad = () => {
      const canvas = element.contentDocument;

      if (!canvas) return;

      const page = canvas.documentElement;

      observer?.disconnect();
      // The page's own box, since its scroll height is never less than the frame it sits in.
      observer = new ResizeObserver(() => setHeight(page.offsetHeight));
      observer.observe(page);
      canvas.addEventListener("click", onClick);
    };

    element.addEventListener("load", onLoad);

    return () => {
      element.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <iframe
        ref={frame}
        title={t("agent.canvas.title")}
        // Without `allow-scripts`, being same-origin only lets the app measure and watch the canvas.
        sandbox="allow-same-origin"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CANVAS_POLICY}"><style>${style}</style></head><body>${html}</body></html>`}
        className="my-3 block w-full border-0"
        style={{ height }}
      />
      <AgentLinkDialog
        href={link}
        isOpen={linkOpen}
        onOpenChange={setLinkOpen}
      />
    </>
  );
}

/** A canvas the agent wrote as an `html` fence, drawn once the fence closes. */
export function AgentCanvas({ html }: { html: string }) {
  const { t } = useTranslation();

  return useIsCodeFenceIncomplete() ? (
    <div className="my-3 flex h-32 items-center justify-center rounded-sm pencil text-xs text-muted">
      {t("agent.canvas.drawing")}
    </div>
  ) : (
    <CanvasFrame html={html} />
  );
}
