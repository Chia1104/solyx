import type { TFunction } from "i18next";

import { MandateViolationCode } from "@solyx/core/mandate";
import type { MandateViolation } from "@solyx/core/mandate";

/** Why the user's mandate does not cover a proposal, in the user's words for it. */
export function mandateViolationMessage(
  t: TFunction,
  violation: MandateViolation
) {
  switch (violation.code) {
    case MandateViolationCode.OrderValue:
    case MandateViolationCode.DayValue:
      return violation.max === null
        ? t("mandate.violations.currency", { currency: violation.currency })
        : t(`mandate.violations.${violation.code}`, {
            value: violation.value,
            max: violation.max,
            currency: violation.currency,
          });
    case MandateViolationCode.DayOrders:
      return t("mandate.violations.day-orders", { max: violation.max });
    default:
      return t(`mandate.violations.${violation.code}`);
  }
}
