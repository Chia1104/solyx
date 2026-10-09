import { Children, isValidElement, useState } from "react";
import type { ReactNode } from "react";

import { AlertDialog, Button, ScrollShadow, cn } from "@heroui/react";
import { tableVariants } from "@heroui/styles";
import { cjk } from "@streamdown/cjk";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";

/** Streamdown hands a fence's body as a string, or as a `<code>` element wrapping one. */
function codeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? child.props.children
        : child
    )
    .join("");
}

/**
 * A link from the model opens in the browser only after the user reads the address, since
 * nothing checked where it points.
 */
const MarkdownLink: Components["a"] = ({ children, className, href }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const linkClass = cn("text-accent underline underline-offset-2", className);

  if (!href?.startsWith("https://")) {
    return <span className={linkClass}>{children}</span>;
  }

  return (
    <>
      <button
        type="button"
        className={cn("text-left", linkClass)}
        onClick={() => setOpen(true)}>
        {children}
      </button>
      <AlertDialog isOpen={open} onOpenChange={setOpen}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-md">
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  {t("agent.link.title")}
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="flex flex-col gap-3">
                <p className="text-sm text-muted">
                  {t("agent.link.description")}
                </p>
                <p className="rounded-sm bg-surface-secondary px-3 py-2 font-mono text-xs break-all">
                  {href}
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="tertiary" onPress={() => setOpen(false)}>
                  {t("agent.link.cancel")}
                </Button>
                <Button
                  onPress={() => {
                    // The main process opens https links in the system browser.
                    window.open(href, "_blank", "noreferrer");
                    setOpen(false);
                  }}>
                  {t("agent.link.open")}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </>
  );
};

// Streamdown memoizes on these by identity, so they live outside the component.
const controls = { table: false, mermaid: false };

const plugins = { cjk };

const table = tableVariants({ variant: "secondary" });

/**
 * Holds back a table until its delimiter row is complete, so its header does not flash as a
 * line of pipes and its columns take their alignment at once.
 */
function holdTableHead(text: string): string {
  const lines = text.split("\n");
  const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  let start = end;

  while (lines[start - 1]?.trimStart().startsWith("|")) start--;

  // Every line before the last ended in a newline.
  return start < end && lines.length - 1 - start < 2
    ? lines.slice(0, start).join("\n")
    : text;
}

// Streamdown's defaults use shadcn tokens, which HeroUI's palette does not define.
const components: Components = {
  code: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-sm bg-surface-secondary p-3 font-mono text-xs leading-relaxed">
      {codeText(children).replace(/\n$/, "")}
    </pre>
  ),
  inlineCode: ({ className, children }) => (
    <code
      className={cn(
        "rounded-sm bg-surface-secondary px-1 py-0.5 font-mono text-[0.875em]",
        className
      )}>
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-separator pl-3 text-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-separator" />,
  // HeroUI's Table is a React Aria grid; a reply's table is prose, so it borrows only the styles.
  // Replacing Streamdown's wrapper also drops its nested scroller that follows a streaming table.
  table: ({ children }) => (
    <div className={cn(table.base(), "my-3")}>
      <ScrollShadow orientation="horizontal">
        <table className={table.content({ className: "tabular-nums" })}>
          {children}
        </table>
      </ScrollShadow>
    </div>
  ),
  thead: ({ children }) => <thead className={table.header()}>{children}</thead>,
  tbody: ({ children }) => <tbody className={table.body()}>{children}</tbody>,
  tr: ({ children }) => <tr className={table.row()}>{children}</tr>,
  // `style` carries the alignment a delimiter row sets. A column keeps its width in a narrow
  // pane, and a wide table scrolls sideways, faded at the edge that has more.
  th: ({ children, style }) => (
    <th className={table.column({ className: "min-w-32" })} style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className={table.cell()} style={style}>
      {children}
    </td>
  ),
  a: MarkdownLink,
  // An image would load from wherever the model pointed it, so it is shown as its link.
  img: ({ alt, src }) => {
    const url = src ? URL.parse(String(src)) : null;

    return url ? (
      <MarkdownLink href={url.href}>{alt || url.href}</MarkdownLink>
    ) : null;
  },
};

/** The CJK plugin keeps emphasis working next to Chinese punctuation. */
export function AgentMarkdown({
  text,
  streaming,
}: {
  text: string;
  /** Repairs half-written blocks while the reply streams. */
  streaming: boolean;
}) {
  return (
    <Streamdown
      className="text-sm leading-6 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold"
      components={components}
      controls={controls}
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
      plugins={plugins}>
      {streaming ? holdTableHead(text) : text}
    </Streamdown>
  );
}
