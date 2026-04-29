import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Project } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiJob = { id: number; name: string };
type ApiCurrency = { code: string; sign: string };
type ApiBudget = { minimum?: number; maximum?: number };

type ApiUserStatus = {
  payment_verified?: boolean | null;
  identity_verified?: boolean | null;
  deposit_made?: boolean | null;
  phone_verified?: boolean | null;
  email_verified?: boolean | null;
  facebook_connected?: boolean | null;
  profile_complete?: boolean | null;
};

type ApiUser = {
  id: number;
  username?: string;
  display_name?: string;
  location?: { country?: { name?: string } };
  status?: ApiUserStatus;
  employer_reputation?: {
    entire_history?: {
      complete?: number;
      incomplete?: number;
      reviews?: number;
    };
  };
};

type ApiProject = {
  id: number;
  title: string;
  seo_url: string;
  description?: string;
  jobs?: ApiJob[];
  budget?: ApiBudget;
  currency?: ApiCurrency;
  time_submitted?: number;
  bid_stats?: { bid_count?: number };
  owner_id?: number;
};

type ApiProjectsResponse = {
  status: string;
  result?: {
    projects?: ApiProject[];
    users?: Record<string, ApiUser>;
    total_count?: number;
  };
  message?: string;
};

type ScrapedEmployer = {
  country: string | null;
  username: string | null;
  identity_verified: boolean;
  payment_verified: boolean;
  deposit_made: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  profile_complete: boolean;
  facebook_connected: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.freelancer.com";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SESSION_FILE = path.join("data", "fl-session.json");

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatBudget(p: ApiProject): string | undefined {
  const b = p.budget;
  const c = p.currency;
  if (!b) return undefined;
  const sign = c?.sign ?? c?.code ?? "$";
  if (b.minimum != null && b.maximum != null) return `${sign}${b.minimum} – ${sign}${b.maximum}`;
  if (b.minimum != null) return `${sign}${b.minimum}+`;
  if (b.maximum != null) return `up to ${sign}${b.maximum}`;
  return undefined;
}

function formatVerification(s: ScrapedEmployer): string {
  const v = "🟢";
  const x = "⚪";
  return [
    `${s.identity_verified ? v : x}🪪`,
    `${s.payment_verified ? v : x}💰`,
    `${s.deposit_made ? v : x}💳`,
    `${s.email_verified ? v : x}✉️`,
    `${s.phone_verified ? v : x}📞`,
    `${s.profile_complete ? v : x}👤`,
  ].join(" ");
}

function parseSearchUrl(input: string): { jobIds: number[]; languages: string[] } {
  try {
    const url = new URL(input);
    const skillsParam = url.searchParams.get("projectSkills");
    const jobIds = skillsParam
      ? skillsParam.split(",").map(Number).filter(Boolean)
      : url.searchParams.getAll("projectSkills[]").map(Number).filter(Boolean);
    const langsParam = url.searchParams.get("projectLanguages");
    const languages = langsParam
      ? langsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : url.searchParams.getAll("projectLanguages[]").filter(Boolean);
    return { jobIds, languages };
  } catch {
    return { jobIds: [], languages: [] };
  }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

type SavedCookie = {
  name: string; value: string; domain: string;
  path: string; expires: number; httpOnly: boolean;
  secure: boolean; sameSite?: "Strict" | "Lax" | "None";
};

async function loadSession(): Promise<{ cookies: SavedCookie[]; savedAt: number } | null> {
  try {
    return JSON.parse(await readFile(SESSION_FILE, "utf8"));
  } catch { return null; }
}

async function saveSession(cookies: SavedCookie[]): Promise<void> {
  await mkdir(path.dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify({ cookies, savedAt: Date.now() }, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// DOM scraper — runs in browser context, returns plain object
// ---------------------------------------------------------------------------

const SCRAPER_FN = `
(function scrapeEmployer() {
  var text = document.body ? document.body.innerText : '';

  // Find the client section
  var idx = text.indexOf('About the Client');
  if (idx < 0) idx = text.indexOf('Client Verification');
  if (idx < 0) idx = text.indexOf('Client Details');
  var area = idx >= 0 ? text.slice(idx, idx + 800) : text.slice(0, 3000);

  // Extract country — lines between heading and first number
  var country = null;
  if (idx >= 0) {
    var section = text.slice(idx, idx + 400);
    var lines = section.split('\\n');
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      if (l === 'About the Client' || l === 'Client Verification' || l === 'Client Details') continue;
      if (/^[0-9.]/.test(l)) break;
      if (l.startsWith('Member') || l.startsWith('Upgrade') || l.startsWith('Client')) continue;
      if (l.length > 1 && l.length < 50) country = l;
    }
  }

  // Get employer username from /u/ profile links in the About section
  // Exclude Freelancer staff accounts (FL prefix like FLTrowa, FLWinona)
  var username = null;
  var links = document.querySelectorAll('a[href*="/u/"]');
  for (var j = 0; j < links.length; j++) {
    var href = links[j].href || '';
    var m = href.match(/\\/u\\/([A-Za-z0-9_]+)/);
    if (m && m[1] && !/^FL[A-Z]/.test(m[1])) {
      username = m[1];
      break;
    }
  }

  return {
    country: country,
    username: username,
    identity_verified: area.indexOf('Identity verified') >= 0,
    payment_verified: area.indexOf('Payment verified') >= 0,
    deposit_made: area.indexOf('Deposit made') >= 0,
    email_verified: area.indexOf('Email verified') >= 0,
    phone_verified: area.indexOf('Phone verified') >= 0,
    profile_complete: area.indexOf('Profile completed') >= 0,
    facebook_connected: area.indexOf('Facebook connected') >= 0
  };
})()
`;

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export class FreelancerCollector {
  private browser: Browser | null = null;
  private mainPage: Page | null = null;   // used for API calls
  private enrichPage: Page | null = null; // used for project page scraping

  private readonly email: string;
  private readonly password: string;

  constructor(opts: { email: string; password: string }) {
    this.email = opts.email;
    this.password = opts.password;
  }

  async init(): Promise<void> {
    this.browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox",
             "--disable-blink-features=AutomationControlled",
             "--disable-dev-shm-usage", "--window-size=1280,800"],
    });

    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

    this.mainPage = await this.browser.newPage();
    await this.mainPage.setViewport({ width: 1280, height: 800 });
    await this.mainPage.setUserAgent(ua);
    await this.mainPage.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await this.mainPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    this.enrichPage = await this.browser.newPage();
    await this.enrichPage.setViewport({ width: 1280, height: 800 });
    await this.enrichPage.setUserAgent(ua);
    await this.enrichPage.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await this.enrichPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const session = await loadSession();
    if (session && Date.now() - session.savedAt < 1000 * 60 * 60 * 24 * 7) {
      console.log("[collector] Restoring saved session...");
      await this.mainPage.setCookie(...session.cookies);
      await this.enrichPage.setCookie(...session.cookies);
      await this.mainPage.goto(`${BASE_URL}/api/users/0.1/self/?compact=true`, {
        waitUntil: "domcontentloaded", timeout: 15000,
      }).catch(() => {});
      if (await this.verifySession()) {
        console.log("[collector] Session restored successfully.");
        return;
      }
      console.log("[collector] Saved session expired, logging in again...");
    }
    await this.login();
  }

  private async verifySession(): Promise<boolean> {
    if (!this.mainPage) return false;
    try {
      const r = await this.mainPage.evaluate(async () => {
        const res = await fetch("/api/users/0.1/self/?compact=true");
        const d = await res.json() as { status: string; result?: { username?: string } };
        return { status: d.status, username: d.result?.username };
      });
      return r.status === "success" && Boolean(r.username);
    } catch { return false; }
  }

  private async login(): Promise<void> {
    if (!this.mainPage) throw new Error("Page not initialized");
    console.log("[collector] Logging in to Freelancer...");

    await this.mainPage.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2", timeout: 60000 });
    console.log("[collector] Login page URL:", this.mainPage.url());

    const emailSel = 'fl-email-input input, input[type="email"], input[name="username"], input[id*="email"]';
    try {
      await this.mainPage.waitForSelector(emailSel, { timeout: 40000 });
    } catch {
      const url = this.mainPage.url();
      if (!url.includes("/login")) {
        if (await this.verifySession()) {
          const cookies = await this.mainPage.cookies();
          await this.enrichPage!.setCookie(...cookies);
          await saveSession(cookies);
          console.log("[collector] Already logged in, session saved.");
          return;
        }
      }
      throw new Error(`[collector] Login page did not render. URL: ${url}`);
    }

    await new Promise(r => setTimeout(r, 1000));
    await this.mainPage.focus(emailSel);
    await this.mainPage.keyboard.type(this.email, { delay: 60 });
    await this.mainPage.waitForSelector('fl-password-input input, input[type="password"]', { timeout: 10000 });
    await this.mainPage.focus('fl-password-input input, input[type="password"]');
    await this.mainPage.keyboard.type(this.password, { delay: 60 });
    await new Promise(r => setTimeout(r, 500));
    await this.mainPage.keyboard.press("Enter");

    try {
      await this.mainPage.waitForFunction("!document.location.href.includes('/login')", { timeout: 60000 });
    } catch {
      console.log("[collector] Please solve any CAPTCHA in the browser window (120s timeout)...");
      await this.mainPage.waitForFunction("!document.location.href.includes('/login')", { timeout: 120000 });
    }

    if (!await this.verifySession()) {
      throw new Error("[collector] Login failed — check FREELANCER_EMAIL and FREELANCER_PASSWORD");
    }

    const cookies = await this.mainPage.cookies();
    await this.enrichPage!.setCookie(...cookies);
    await saveSession(cookies);
    console.log("[collector] Login successful, session saved.");
  }

  // ---------------------------------------------------------------------------
  // Fetch employer data by scraping the rendered project page DOM
  // Uses a dedicated enrichPage so mainPage is never interrupted
  // ---------------------------------------------------------------------------

  private async fetchEmployerFromProjectPage(seoUrl: string): Promise<ScrapedEmployer | null> {
    if (!this.enrichPage) return null;

    try {
      await this.enrichPage.goto(`${BASE_URL}/projects/${seoUrl}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      // Wait for Angular to render the client section
      try {
        await this.enrichPage.waitForFunction(
          "document.body.innerText.indexOf('About the Client') >= 0 || document.body.innerText.indexOf('Client Verification') >= 0",
          { timeout: 12000 }
        );
      } catch {
        await new Promise(r => setTimeout(r, 5000));
      }

      const result = await this.enrichPage.evaluate(SCRAPER_FN) as ScrapedEmployer | null;
      return result ?? null;
    } catch (e) {
      console.error(`[collector] Scrape error for ${seoUrl}:`, (e as Error).message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Main collection
  // ---------------------------------------------------------------------------

  async collectFromSearchUrl(searchUrl: string, limit = 20): Promise<Project[]> {
    if (!this.mainPage) throw new Error("Collector not initialized");

    const { jobIds, languages } = parseSearchUrl(searchUrl);

    const apiUrl = new URL(`${BASE_URL}/api/projects/0.1/projects/active/`);
    for (const id of jobIds) apiUrl.searchParams.append("job_ids[]", String(id));
    for (const l of languages) apiUrl.searchParams.append("languages[]", l);
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("offset", "0");
    apiUrl.searchParams.set("sort_field", "time_submitted");
    apiUrl.searchParams.set("job_details", "true");
    apiUrl.searchParams.set("full_description", "true");
    apiUrl.searchParams.set("compact", "true");
    apiUrl.searchParams.set("new_errors", "true");
    apiUrl.searchParams.set("new_pools", "true");

    const result = await this.mainPage.evaluate(async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      return r.json() as Promise<ApiProjectsResponse>;
    }, apiUrl.toString());

    const projects = result?.result?.projects ?? [];
    console.log(`[collector] Fetched ${projects.length} projects`);

    return projects
      .filter(p => p.id && p.title && p.seo_url)
      .map(p => ({
        id: String(p.id),
        title: p.title,
        url: `${BASE_URL}/projects/${p.seo_url}`,
        description: p.description?.slice(0, 800),
        skills: (p.jobs ?? []).map(j => j.name).filter(Boolean),
        budgetText: formatBudget(p),
        postedAtText: p.time_submitted
          ? new Date(p.time_submitted * 1000).toISOString()
          : undefined,
        proposalsText: p.bid_stats?.bid_count != null
          ? String(p.bid_stats.bid_count)
          : undefined,
        clientName: undefined,
        clientCountry: undefined,
        clientVerificationText: undefined,
        completionRateText: undefined,
      }));
  }

  // ---------------------------------------------------------------------------
  // Enrich a single project with employer data
  // ---------------------------------------------------------------------------

  async enrichProjectWithEmployer(project: Project): Promise<Project> {
    const seoMatch = project.url.match(/freelancer\.com\/projects\/(.+)$/);
    if (!seoMatch) return project;
    const seoUrl = seoMatch[1];

    console.log(`[collector] Fetching employer for: ${project.title.slice(0, 40)}`);
    const scraped = await this.fetchEmployerFromProjectPage(seoUrl);

    if (!scraped) {
      console.log(`[collector] No employer data for project ${project.id}`);
      return project;
    }

    console.log(`[collector] Employer: ${scraped.username ?? "?"} | ${scraped.country ?? "?"} | ID:${scraped.identity_verified} Pay:${scraped.payment_verified} Email:${scraped.email_verified}`);

    return {
      ...project,
      clientName: scraped.username ?? undefined,
      clientCountry: scraped.country ?? undefined,
      clientVerificationText: formatVerification(scraped),
      completionRateText: undefined, // not available from DOM scrape
    };
  }

  async close(): Promise<void> {
    try { await this.browser?.close(); } catch { /* ignore */ }
    this.browser = null;
    this.mainPage = null;
    this.enrichPage = null;
  }
}
