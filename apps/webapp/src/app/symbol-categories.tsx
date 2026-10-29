import { useId, useRef, useState } from "react";

import {
  Dropdown,
  Header,
  Label,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  cn,
} from "@heroui/react";
import { dropdownVariants } from "@heroui/styles";
import {
  Bookmark01Icon,
  Briefcase01Icon,
  ChartLineData01Icon,
  DiamondIcon,
  FireIcon,
  Flag01Icon,
  GlobalIcon,
  Rocket01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useDebouncedCallback } from "@tanstack/react-pacer";
import { Menu, Popover } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { Icon } from "../components/icon.tsx";
import { PositionList } from "../modules/account/position-list.tsx";
import { Watchlist } from "../modules/watchlist/watchlist.tsx";

import { CategoryIcon, useLayoutStore } from "./layout-store.ts";

const TOOLTIP_DELAY = 600;

// How far a sideways swipe over the lists travels before it moves to the next category.
const SWIPE_DISTANCE = 60;

// A swipe ends once the wheel has been still this long, so one swipe moves one category.
const SWIPE_SETTLE_MS = 200;

// The category that leaves every market in, `null` in the layout store.
const EVERY_MARKET = "all";

/** The categories in the order their dots lie: every market, then each market alone. */
const CATEGORIES: (Market | null)[] = [null, ...Object.values(Market)];

const categoryKey = (market: Market | null) => market ?? EVERY_MARKET;

const GLYPHS: Record<Exclude<CategoryIcon, "dot">, IconSvgElement> = {
  [CategoryIcon.Star]: StarIcon,
  [CategoryIcon.Chart]: ChartLineData01Icon,
  [CategoryIcon.Briefcase]: Briefcase01Icon,
  [CategoryIcon.Globe]: GlobalIcon,
  [CategoryIcon.Flag]: Flag01Icon,
  [CategoryIcon.Flame]: FireIcon,
  [CategoryIcon.Bookmark]: Bookmark01Icon,
  [CategoryIcon.Rocket]: Rocket01Icon,
  [CategoryIcon.Diamond]: DiamondIcon,
};

function useCategoryName() {
  const { t } = useTranslation();

  return (market: Market | null) =>
    market === null ? t("market-filter.every") : t(`market.${market}`);
}

/** A category's mark, in a box as wide as an icon so a dot lines up with the icons beside it. */
function CategoryGlyph({ icon }: { icon: CategoryIcon }) {
  return (
    <span aria-hidden className="grid size-4 shrink-0 place-items-center">
      {icon === CategoryIcon.Dot ? (
        <span className="size-1.5 rounded-full bg-current" />
      ) : (
        <Icon icon={GLYPHS[icon]} className="size-3.5" />
      )}
    </span>
  );
}

/**
 * The lists the user follows and holds in the category picked, under its name. A category picked
 * slides in from the side its dot lies on, and a sideways swipe over the lists moves to the next.
 */
export function CategoryLists() {
  const { t } = useTranslation();
  const name = useCategoryName();
  const watchlistId = useId();
  const positionsId = useId();
  const market = useLayoutStore((state) => state.symbolsMarket);
  const setMarket = useLayoutStore((state) => state.setSymbolsMarket);

  const index = CATEGORIES.indexOf(market);
  const [last, setLast] = useState(index);
  const [forward, setForward] = useState<boolean | null>(null);

  if (index !== last) {
    setLast(index);
    setForward(index > last);
  }

  const swipe = useRef({ distance: 0, moved: false });

  // Cancelled as the component unmounts.
  const settle = useDebouncedCallback(
    () => {
      swipe.current = { distance: 0, moved: false };
    },
    { wait: SWIPE_SETTLE_MS }
  );

  return (
    <div
      key={categoryKey(market)}
      className={cn(
        "flex min-h-0 flex-1 flex-col pt-4",
        forward !== null &&
          cn(
            forward
              ? "animate-[category-in-from-end_200ms_var(--ease-out-quint)]"
              : "animate-[category-in-from-start_200ms_var(--ease-out-quint)]",
            "motion-reduce:animate-[fade-in_200ms_var(--ease-out-quint)]"
          )
      )}
      onWheel={(event) => {
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

        settle();

        const current = swipe.current;

        if (current.moved) return;

        current.distance += event.deltaX;

        if (Math.abs(current.distance) < SWIPE_DISTANCE) return;

        current.moved = true;

        // Past either end there is no category to move to.
        const next = CATEGORIES[index + Math.sign(current.distance)];

        if (next !== undefined) setMarket(next);
      }}>
      <h2 className="shrink-0 px-4 text-sm font-semibold text-muted">
        {name(market)}
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-3">
        <section aria-labelledby={watchlistId} className="flex flex-col gap-1">
          <h3 id={watchlistId} className="px-4 text-xs font-medium text-muted">
            {t("watchlist.title")}
          </h3>
          <Watchlist market={market} />
        </section>
        <section aria-labelledby={positionsId} className="flex flex-col gap-1">
          <h3 id={positionsId} className="px-4 text-xs font-medium text-muted">
            {t("account.positions")}
          </h3>
          <PositionList market={market} />
        </section>
      </div>
    </div>
  );
}

/**
 * What a right click on a category's dot offers: the icon it is drawn as. A menu styled as HeroUI's
 * dropdown in a popover of its own, since a dropdown would also open on the dot's own press.
 */
function CategoryMenu({
  category,
  anchor,
  onClose,
}: {
  category: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const icon = useLayoutStore(
    (state) => state.categoryIcons[category] ?? CategoryIcon.Dot
  );

  const setIcon = useLayoutStore((state) => state.setCategoryIcon);
  const slots = dropdownVariants();

  return (
    <Popover
      isOpen
      triggerRef={{ current: anchor }}
      placement="top"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={slots.popover()}>
      <Menu
        autoFocus="first"
        aria-label={t("workspace.category-menu")}
        className={slots.menu()}>
        <Dropdown.Section
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[icon]}
          onSelectionChange={(keys) => {
            const [key] = keys;

            if (isEnumValue(CategoryIcon, key)) setIcon(category, key);

            onClose();
          }}>
          <Header>{t("workspace.category-icon")}</Header>
          {Object.values(CategoryIcon).map((each) => (
            <Dropdown.Item
              key={each}
              id={each}
              textValue={t(`workspace.category-icons.${each}`)}>
              <CategoryGlyph icon={each} />
              <Label>{t(`workspace.category-icons.${each}`)}</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Section>
      </Menu>
    </Popover>
  );
}

/**
 * Picks the category the lists keep to, each drawn as the icon picked for it and the one shown
 * inked; its name heads the lists, and a right click on one opens what can be changed of it.
 */
export function CategoryDots() {
  const { t } = useTranslation();
  const name = useCategoryName();
  const market = useLayoutStore((state) => state.symbolsMarket);
  const setMarket = useLayoutStore((state) => state.setSymbolsMarket);
  const icons = useLayoutStore((state) => state.categoryIcons);

  const [menu, setMenu] = useState<{
    category: string;
    anchor: HTMLElement;
  } | null>(null);

  return (
    <>
      <ToggleButtonGroup
        isDetached
        aria-label={t("workspace.categories")}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        selectedKeys={[categoryKey(market)]}
        onSelectionChange={(keys) => {
          const [key] = keys;

          setMarket(isEnumValue(Market, key) ? key : null);
        }}>
        {CATEGORIES.map((each) => {
          const category = categoryKey(each);

          return (
            // The menu opens on the dot's box, which a right click or the menu key reaches through the dot.
            <span
              key={category}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ category, anchor: event.currentTarget });
              }}>
              <Tooltip delay={TOOLTIP_DELAY}>
                <ToggleButton
                  isIconOnly
                  variant="ghost"
                  id={category}
                  aria-label={name(each)}
                  className="text-muted data-selected:bg-transparent data-selected:text-foreground">
                  <CategoryGlyph icon={icons[category] ?? CategoryIcon.Dot} />
                </ToggleButton>
                <Tooltip.Content>{name(each)}</Tooltip.Content>
              </Tooltip>
            </span>
          );
        })}
      </ToggleButtonGroup>
      {menu === null ? null : (
        <CategoryMenu
          category={menu.category}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
