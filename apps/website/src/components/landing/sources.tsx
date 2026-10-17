import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import type websiteEnUS from "@solyx/i18n/website/en-US.json";

import { langParam, useLocale } from "../../lib/i18n.ts";
import { Badge } from "../ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.tsx";

import {
  MODEL_PROVIDERS,
  ProviderLogo,
  WEB_SEARCH_VENDORS,
} from "./providers.tsx";
import type { Provider } from "./providers.tsx";
import { SheetHead, SheetRow } from "./sheet.tsx";

/** How many providers' logos the model's cell shows before it counts the rest. */
const PROVIDERS_SHOWN = 8;

type SourceKey = keyof (typeof websiteEnUS)["sources"]["items"];

/** The sources in the order the grid shows them; the catalog holds each one's words. */
const SOURCES: SourceKey[] = [
  "quotes",
  "finmind",
  "exchanges",
  "macro",
  "model",
  "web",
];

/** The source whose cell and dialog show the model providers. */
const MODEL: SourceKey = "model";

/** The source whose cell shows the web search vendors. */
const WEB: SourceKey = "web";

function ProviderGrid() {
  const { t } = useTranslation();

  return (
    <ul
      aria-label={t("sources.providers-label")}
      className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
      {MODEL_PROVIDERS.map((provider) => (
        <li key={provider.name} className="flex items-center gap-2.5">
          <ProviderLogo provider={provider} className="size-4" />
          {provider.name}
        </li>
      ))}
    </ul>
  );
}

function ProviderStrip({
  label,
  providers,
}: {
  label: string;
  providers: Provider[];
}) {
  const { t } = useTranslation();
  const rest = providers.length - PROVIDERS_SHOWN;

  return (
    <ul aria-label={label} className="mt-4 flex flex-wrap items-center gap-2.5">
      {providers.slice(0, PROVIDERS_SHOWN).map((provider) => (
        <li key={provider.name} title={provider.name} className="flex">
          <ProviderLogo provider={provider} />
          <span className="sr-only">{provider.name}</span>
        </li>
      ))}
      {rest > 0 && (
        <li className="text-muted-foreground text-sm">
          {t("sources.providers-more", { count: rest })}
        </li>
      )}
    </ul>
  );
}

function DetailList({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function SourceCell({ id }: { id: SourceKey }) {
  const { t } = useTranslation();
  const item = t(`sources.items.${id}`, { returnObjects: true });
  const { purpose, source } = item;
  const bring = "bring" in item ? Object.values(item.bring) : [];
  const uses = Object.values(item.uses);
  const notes = Object.values(item.notes);
  const providers = id === MODEL;

  return (
    <li className="group relative flex min-h-48 flex-col bg-background px-6 pt-7 pb-8 transition-colors hover:bg-muted/50 md:px-7">
      <Dialog>
        <h3 className="pr-10 font-semibold">
          {/* The title opens the details, and its hit area covers the whole cell. */}
          <DialogTrigger className="focus-visible:after:ring-ring text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset">
            {purpose}
          </DialogTrigger>
        </h3>
        <span
          aria-hidden="true"
          className="text-muted-foreground absolute top-6.5 right-6 grid size-7 place-items-center rounded-full border border-border transition-colors group-hover:text-foreground">
          <Plus className="size-3.5" />
        </span>
        <p className="text-muted-foreground mt-1.5 text-[0.9375rem]">
          {source}
        </p>
        {providers && (
          <ProviderStrip
            label={t("sources.providers-label")}
            providers={MODEL_PROVIDERS}
          />
        )}
        {id === WEB && (
          <ProviderStrip
            label={t("sources.vendors-label")}
            providers={WEB_SEARCH_VENDORS}
          />
        )}
        <p className="mt-auto flex flex-wrap gap-1.5 pt-5">
          {bring.length > 0 ? (
            bring.map((thing) => (
              <Badge key={thing} variant="outline" className="h-6 px-2.5">
                {thing}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground text-sm">
              {t("sources.nothing")}
            </span>
          )}
        </p>

        <DialogContent className={providers ? "sm:max-w-2xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="pr-8 text-lg">{purpose}</DialogTitle>
            <DialogDescription>{source}</DialogDescription>
          </DialogHeader>
          <DetailList title={t("sources.uses")}>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4 leading-relaxed">
              {uses.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </DetailList>
          {providers && (
            <DetailList title={t("sources.providers")}>
              <ProviderGrid />
            </DetailList>
          )}
          <DetailList title={t("sources.notes")}>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4 leading-relaxed">
              {notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </DetailList>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function Sources() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <>
      <SheetRow>
        <SheetHead id="sources" title={t("sources.title")}>
          {t("sources.lede")}
        </SheetHead>
      </SheetRow>

      <SheetRow>
        <ul
          aria-labelledby="sources"
          className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {SOURCES.map((id) => (
            <SourceCell key={id} id={id} />
          ))}
        </ul>
      </SheetRow>

      <SheetRow>
        <p className="text-muted-foreground px-6 py-7 md:px-10">
          {t("sources.more")}{" "}
          <Link
            to="/{-$lang}/docs/$"
            params={{ lang: langParam(locale), _splat: "keys" }}
            className="link">
            {t("sources.more-link")}
          </Link>
        </p>
      </SheetRow>
    </>
  );
}
