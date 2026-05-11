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
  completionRateText?: string;
  proposalsText?: string;
  scoreText?: string;
  recruiter?: boolean;
  projIsHourly?: boolean;
  joinDate?: string;
};

export type MatchResult = {
  project: Project;
  decision: FastDecision;
};

