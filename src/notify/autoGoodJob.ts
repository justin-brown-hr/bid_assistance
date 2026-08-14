import type { Project } from "../types.js";

export type AutoGoodJobRules = {
  fixedMinUsd: number;
  hourlyMinUsd: number;
};

export const DEFAULT_AUTO_GOOD_JOB_RULES: AutoGoodJobRules = {
  fixedMinUsd: 260,
  hourlyMinUsd: 21,
};

/** Rough USD rates when Freelancer exchange rate is missing (local × rate ≈ USD). */
const FALLBACK_TO_USD: Record<string, number> = {
  USD: 1,
  AUD: 0.65,
  CAD: 0.73,
  EUR: 1.08,
  GBP: 1.27,
  NZD: 0.60,
  SGD: 0.74,
  INR: 0.012,
  PKR: 0.0036,
  HKD: 0.13,
  JPY: 0.0067,
  CHF: 1.12,
  SEK: 0.095,
  NOK: 0.092,
  DKK: 0.145,
  ZAR: 0.055,
  MXN: 0.055,
  BRL: 0.18,
  PHP: 0.017,
  MYR: 0.22,
  THB: 0.028,
  IDR: 0.000063,
  AED: 0.27,
  SAR: 0.27,
};

function parseMaxFromBudgetText(budgetText: string | undefined): number | undefined {
  if (!budgetText) return undefined;
  const t = budgetText.replace(/,/g, "");
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const valid = nums.filter((n) => Number.isFinite(n));
  if (!valid.length) return undefined;
  return Math.max(...valid);
}

/** Rate that converts 1 unit of project currency → USD. */
export function usdRateForProject(project: Project): number {
  const code = String(project.currencyCode || "USD").toUpperCase();
  if (code === "USD" || code === "US$") return 1;
  if (
    typeof project.exchangeRateToUsd === "number"
    && Number.isFinite(project.exchangeRateToUsd)
    && project.exchangeRateToUsd > 0
  ) {
    return project.exchangeRateToUsd;
  }
  return FALLBACK_TO_USD[code] ?? 1;
}

/**
 * Max budget in USD for comparison.
 * Non-USD amounts are always converted (Freelancer rate, else fallback table).
 */
export function projectMaxBudgetUsd(project: Project): number | undefined {
  const code = String(project.currencyCode || "USD").toUpperCase();
  const isUsd = code === "USD" || code === "US$" || !project.currencyCode;

  // Prefer collector-computed USD when present and currency was converted.
  if (typeof project.maxBudgetUsd === "number" && Number.isFinite(project.maxBudgetUsd)) {
    // If currency is USD, value is already USD.
    // If non-USD, collector should have multiplied by Freelancer exchangerate.
    return project.maxBudgetUsd;
  }

  const raw = parseMaxFromBudgetText(project.budgetText);
  if (raw == null) return undefined;
  if (isUsd) return raw;
  return raw * usdRateForProject(project);
}

export function isPaymentVerified(project: Project): boolean {
  if (project.paymentVerified === true) return true;
  const text = String(project.clientVerificationText || "").toLowerCase();
  return text.includes("payment");
}

/**
 * Auto Good Job when:
 * - payment verified
 * - max budget in USD: fixed > $260, hourly > $21
 */
export function shouldAutoGoodJob(
  project: Project,
  rules: AutoGoodJobRules = DEFAULT_AUTO_GOOD_JOB_RULES,
): { ok: true; maxBudgetUsd: number } | { ok: false; reason: string } {
  if (!isPaymentVerified(project)) {
    return { ok: false, reason: "payment not verified" };
  }
  const maxUsd = projectMaxBudgetUsd(project);
  if (maxUsd == null) {
    return { ok: false, reason: "budget unknown" };
  }
  const hourly = project.projIsHourly === true;
  const min = hourly ? rules.hourlyMinUsd : rules.fixedMinUsd;
  const code = String(project.currencyCode || "USD").toUpperCase();
  if (!(maxUsd > min)) {
    return {
      ok: false,
      reason: hourly
        ? `hourly max ~$${maxUsd.toFixed(2)} USD (${code}) ≤ $${min}/hr`
        : `fixed max ~$${maxUsd.toFixed(2)} USD (${code}) ≤ $${min}`,
    };
  }
  return { ok: true, maxBudgetUsd: maxUsd };
}
