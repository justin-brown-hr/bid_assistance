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
  currencyCode?: string;
  postedAtText?: string;
  clientName?: string;
  clientUsername?: string;
  clientCountry?: string;
  clientCountryCode?: string;
  clientVerificationText?: string;
  clientReviewText?: string;
  clientReviewRating?: number;
  clientReviewCount?: number;
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

export type ClientProfile = {
  username: string;
  name: string | null;
  avatar: string | null;
  profileTitle: string | null;
  reviewCount: number | null;
  reviewRate: number | null;
  earning: string | null;
  lastReviewDate: string | null;
  country: string | null;
  joinDate: string | null;
  lastPostedProject: string | null;
  lastPostedTime: number;
  verificationText: string | null;
  openProjects: number | null;
  activeProjects: number | null;
  pastProjects: number | null;
  totalProjects: number | null;
  scrapedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type ClientProfileScrapeRequest = {
  username: string;
  projectUrl: string;
  country?: string;
  joinDate?: string;
  verification?: string;
  postedAt?: number;
};

export type ClientProfileFilters = {
  q?: string;
  username?: string;
  name?: string;
  avatar?: string;
  profileTitle?: string;
  reviewCountMin?: number;
  reviewCountMax?: number;
  reviewRateMin?: number;
  reviewRateMax?: number;
  earning?: string;
  lastReviewDate?: string;
  country?: string;
  joinDate?: string;
  lastPostedProject?: string;
  lastPostedFrom?: number;
  lastPostedTo?: number;
  scrapedFrom?: number;
  scrapedTo?: number;
  createdFrom?: number;
  createdTo?: number;
  updatedFrom?: number;
  updatedTo?: number;
};

