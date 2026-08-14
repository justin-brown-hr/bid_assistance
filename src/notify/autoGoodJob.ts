import type { Project } from "../types.js";

export type AutoGoodJobRules = {
  fixedMinUsd: number;
  hourlyMinUsd: number;
};

export const DEFAULT_AUTO_GOOD_JOB_RULES: AutoGoodJobRules = {
  fixedMinUsd: 260,
  hourlyMinUsd: 21,
};

/** Rough USD rates when Freelancer exchange rate is missing (local units × rate ≈ USD). */
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

export function projectMaxBudgetUsd(project: Project): number | undefined {
  if (typeof project.maxBudgetUsd === "number" && Number.isFinite(project.maxBudgetUsd)) {
    return project.maxBudgetUsd;
  }
  const raw = parseMaxFromBudgetText(project.budgetText);
  if (raw == null) return undefined;
  const code = String(project.currencyCode || "USD").toUpperCase();
  const rate = FALLBACK_TO_USD[code] ?? 1;
  return raw * rate;
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
  if (!(maxUsd > min)) {
    return {
      ok: false,
      reason: hourly
        ? `hourly max $${maxUsd.toFixed(2)} ≤ $${min}/hr`
        : `fixed max $${maxUsd.toFixed(2)} ≤ $${min}`,
    };
  }
  return { ok: true, maxBudgetUsd: maxUsd };
}
