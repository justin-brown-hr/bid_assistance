import type { FastDecision, Project } from "./types.js";

function normalize(s: string) {
  return s.toLowerCase();
}

function extractBudgetUsd(budgetText: string | undefined): number | undefined {
  if (!budgetText) return undefined;
  const t = budgetText.replace(/,/g, "");
  const match = t.match(/\$?\s*(\d+(\.\d+)?)/);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function fastDecision(
  project: Project,
  rules: {
    requiredSkills: string[];
    minBudgetUsd: number;
    scamKeywords: string[];
  },
): FastDecision {
  const reasons: string[] = [];

  const skills = project.skills.map(normalize);
  const req = rules.requiredSkills.filter(Boolean);
  const missing = req.filter((s) => !skills.includes(s));
  if (req.length > 0 && missing.length > 0) {
    return { ok: false, reasons: [`Missing skills: ${missing.join(", ")}`] };
  }
  if (req.length > 0) reasons.push(`Skills matched: ${req.join(", ")}`);

  const budgetUsd = extractBudgetUsd(project.budgetText);
  if (rules.minBudgetUsd > 0) {
    if (budgetUsd === undefined) {
      reasons.push("Budget unknown");
    } else if (budgetUsd < rules.minBudgetUsd) {
      return {
        ok: false,
        reasons: [`Budget too low: ~$${budgetUsd} < $${rules.minBudgetUsd}`],
      };
    } else {
      reasons.push(`Budget ok: ~$${budgetUsd}+`);
    }
  }

  const haystack = normalize(
    [project.title, project.description, project.clientName]
      .filter(Boolean)
      .join("\n"),
  );
  const hit = rules.scamKeywords.find((kw) => kw && haystack.includes(kw));
  if (hit) {
    return { ok: false, reasons: [`Scam keyword hit: "${hit}"`] };
  }

  reasons.push("No obvious scam keyword hits");
  return { ok: true, reasons };
}

