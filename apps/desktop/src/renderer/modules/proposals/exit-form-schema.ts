import { useMemo } from "react";

import { useTranslation } from "react-i18next";
import * as z from "zod";

import { marketSchema } from "@solyx/core/market";
import { MAX_EXIT_DAYS } from "@solyx/core/risk";

/** Rebuilt per language so field errors come out localized; trading rules stay in `checkExit`. */
export function useExitFormSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const required = t("order-form.errors.required");
    const positive = t("order-form.errors.positive");

    // An empty number field holds NaN, which reads as no price.
    const price = z.union([z.nan(), z.number().positive({ error: positive })]);

    return z
      .object({
        market: marketSchema,
        symbol: z.string().trim().min(1, { error: required }),
        quantity: z
          .number({ error: required })
          .int({ error: t("order-form.errors.whole-shares") })
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
        rationale: z.string(),
      })
      .refine(
        ({ stop, target }) => !Number.isNaN(stop) || !Number.isNaN(target),
        { error: t("exit-form.errors.without-price"), path: ["stop"] }
      );
  }, [t]);
}

export type ExitFormValues = z.output<ReturnType<typeof useExitFormSchema>>;
