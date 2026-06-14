import type { DashboardDbSqlite } from "../dashboardDbSqlite.js";
import type { ClientProfileScrapeRequest } from "../types.js";
import { ClientProfileScraper } from "./clientProfileScraper.js";

type PendingJob = ClientProfileScrapeRequest & { postedAt: number };

export class ClientProfileService {
  private scraper: ClientProfileScraper | null = null;
  private readonly pending = new Map<string, PendingJob>();
  private processing = false;
  private started = false;

  constructor(
    private readonly db: DashboardDbSqlite,
    private readonly opts: {
      email: string;
      password: string;
    },
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    console.log("[client-profile] Service started.");
  }

  /** Fire-and-forget — does not block the caller. */
  enqueue(req: ClientProfileScrapeRequest): void {
    const username = req.username.trim().toLowerCase();
    if (!username) return;

    const postedAt = req.postedAt ?? Date.now();
    this.pending.set(username, {
      username,
      projectUrl: req.projectUrl,
      country: req.country,
      joinDate: req.joinDate,
      verification: req.verification,
      postedAt,
    });

    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.pending.size > 0) {
        const entry = this.pending.entries().next().value as [string, PendingJob] | undefined;
        if (!entry) break;
        const [username, job] = entry;
        this.pending.delete(username);

        try {
          if (!this.scraper) {
            this.scraper = new ClientProfileScraper({
              email: this.opts.email,
              password: this.opts.password,
            });
          }
          await this.scraper.init();

          console.log(`[client-profile] Scraping @${username}...`);
          const scraped = await this.scraper.scrape(username);
          const scrapedAt = Date.now();

          this.db.upsertClientProfile({
            username: scraped.username,
            name: scraped.name,
            avatar: scraped.avatar,
            profileTitle: scraped.profileTitle,
            reviewCount: scraped.reviewCount,
            reviewRate: scraped.reviewRate,
            earning: scraped.earning,
            lastReviewDate: scraped.lastReviewDate,
            country: job.country ?? null,
            joinDate: job.joinDate ?? null,
            verificationText: job.verification ?? null,
            openProjects: scraped.openProjects,
            activeProjects: scraped.activeProjects,
            pastProjects: scraped.pastProjects,
            totalProjects: scraped.totalProjects,
            lastPostedProject: job.projectUrl,
            lastPostedTime: job.postedAt,
            scrapedAt,
          });

          console.log(`[client-profile] Saved @${username} (${scraped.name ?? "?"})`);
        } catch (e) {
          console.error(`[client-profile] Failed @${username}:`, e instanceof Error ? e.message : e);
          // Reset scraper on failure so next job re-checks session
          this.scraper = null;
        }
      }
    } finally {
      this.processing = false;
      if (this.pending.size > 0) void this.processQueue();
    }
  }

  async close(): Promise<void> {
    this.scraper = null;
    this.pending.clear();
    this.started = false;
  }
}
