import { useMemo } from "react";

import { useTranslation } from "react-i18next";
import * as z from "zod";

import { marketSchema } from "@solyx/core/market";
import { OrderType, sideSchema } from "@solyx/core/order";

/** Rebuilt per language so field errors come out localized; trading rules stay in `checkOrder`. */
export function useOrderFormSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const required = t("order-form.errors.required");
    const positive = t("order-form.errors.positive");

    const base = z.object({
      market: marketSchema,
      side: sideSchema,
      symbol: z.string().trim().min(1, { error: required }),
      quantity: z
        .number({ error: required })
        .int({ error: t("order-form.errors.whole-shares") })
        .positive({ error: positive }),
      rationale: z.string(),
    });

    return z.discriminatedUnion("type", [
      base.extend({
        type: z.literal(OrderType.Limit),
        limitPrice: z.number({ error: required }).positive({ error: positive }),
      }),
      base.extend({ type: z.literal(OrderType.Market) }),
    ]);
  }, [t]);
}

export type OrderFormValues = z.output<ReturnType<typeof useOrderFormSchema>>;
