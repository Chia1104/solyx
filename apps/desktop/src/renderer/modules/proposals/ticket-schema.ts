import { useMemo } from "react";

import { useTranslation } from "react-i18next";
import * as z from "zod";

import { OrderType, sideSchema } from "@solyx/core/order";
import { MAX_EXIT_DAYS } from "@solyx/core/risk";

/** What a Taiwan order's quantity counts: board lots, or odd shares traded apart from them. */
export const TicketUnit = {
  Lots: "lots",
  Shares: "shares",
} as const;

export type TicketUnit = (typeof TicketUnit)[keyof typeof TicketUnit];

/** Rebuilt per language so field errors come out localized; trading rules stay in `checkOrder`. */
export function useOrderTicketSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const required = t("order-form.errors.required");
    const positive = t("order-form.errors.positive");

    const base = z.object({
      side: sideSchema,
      unit: z.enum(TicketUnit),
      quantity: z
        .number({ error: required })
        .int({ error: t("order-form.errors.whole") })
        .positive({ error: positive }),
    });

    return z.discriminatedUnion("type", [
      base.extend({
        type: z.literal(OrderType.Limit),
        price: z.number({ error: required }).positive({ error: positive }),
      }),
      // A market order keeps the price shown, which it does not send.
      base.extend({ type: z.literal(OrderType.Market), price: z.number() }),
    ]);
  }, [t]);
}

export type OrderTicketValues = z.output<
  ReturnType<typeof useOrderTicketSchema>
>;

/** Rebuilt per language so field errors come out localized; trading rules stay in `checkExit`. */
export function useExitTicketSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const required = t("order-form.errors.required");
    const positive = t("order-form.errors.positive");

    // An empty number field holds NaN, which reads as no price.
    const price = z.union([z.nan(), z.number().positive({ error: positive })]);

    return z
      .object({
        quantity: z
          .number({ error: required })
          .int({ error: t("order-form.errors.whole") })
          .positive({ error: positive }),
        stop: price,
        target: price,
        days: z
          .number({ error: required })
          .int({ error: t("exit-form.errors.whole-days") })
          .min(1, { error: t("exit-form.errors.days", { max: MAX_EXIT_DAYS }) })
          .max(MAX_EXIT_DAYS, {
            error: t("exit-form.errors.days", { max: MAX_EXIT_DAYS }),
          }),
      })
      .refine(
        ({ stop, target }) => !Number.isNaN(stop) || !Number.isNaN(target),
        { error: t("exit-form.errors.without-price"), path: ["stop"] }
      );
  }, [t]);
}

export type ExitTicketValues = z.output<ReturnType<typeof useExitTicketSchema>>;
