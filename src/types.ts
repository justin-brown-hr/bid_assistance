export type FastDecision =
  | { ok: true; reasons: string[] }
  | { ok: false; reasons: string[] };

export type Project = {
  id: string;
  title: string;
  url: string;
  description?: string;
  skills: string[];
  budgetText?: string;
  postedAtText?: string;
  clientName?: string;
  clientCountry?: string;
  clientVerificationText?: string;
  /** e.g. "4.8 (23 reviews)" or "12 / 15" */
  completionRateText?: string;
  proposalsText?: string;
  /** Quality score result e.g. "🟢 Cool (55/70)" */
  scoreText?: string;
};

export type MatchResult = {
  project: Project;
  decision: FastDecision;
};

