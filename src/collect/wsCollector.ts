/**
 * WebSocket-based real-time collector for Freelancer.com
 *
 * Uses Puppeteer to extract the auth hash from the browser session,
 * then connects directly to the Freelancer notification WebSocket from Node.js.
 * This gives instant project notifications — zero poll delay.
 */

import WebSocket from "ws";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Project } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WsProjectData = {
  id: number;
  title: string;
  seo_url: string | number;
  appended_descr?: string;
  jobs_details?: Array<{ id: number; name: string; seo_url: string }>;
  jobString?: string;
  minbudget?: number;
  maxbudget?: number;
  currency?: { sign?: string; code?: string; country?: string; exchangerate?: string };
  currencyCode?: string;
  time_submitted?: number;
  time?: number;
  submitDate?: string;           // "2026-04-28 02:48:20"
  bid_stats?: { bid_count?: number | false };
  userName?: string;
  userId?: number;
  reviews?: number;
  completedProjects?: number;
  overallReputation?: number;
  // Project badges
  NDA?: boolean;
  sealed?: boolean;
  ip_contract?: boolean;
  nonpublic?: boolean;
  hideBids?: boolean;
  client_status?: {
    identity_verified?: boolean;
    payment_verified?: boolean;
    deposit_made?: boolean;
    email_verified?: boolean;
    phone_verified?: boolean;
    profile_complete?: boolean;
    facebook_connected?: boolean;
  };
  type?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.freelancer.com";
const CHROME_PATH = process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "/usr/bin/google-chrome-stable";
const SESSION_FILE = path.join("data", "fl-session.json");
const WS_BASE = "wss://notifications.freelancer.com";

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

type SavedCookie = {
  name: string; value: string; domain: string;
  path: string; expires: number; httpOnly: boolean;
  secure: boolean; sameSite?: "Strict" | "Lax" | "None";
};

async function loadSession(): Promise<{ cookies: SavedCookie[]; savedAt: number } | null> {
  try { return JSON.parse(await readFile(SESSION_FILE, "utf8")); }
  catch { return null; }
}

async function saveSession(cookies: SavedCookie[]): Promise<void> {
  await mkdir(path.dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify({ cookies, savedAt: Date.now() }, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatBudget(d: WsProjectData): string | undefined {
  const sign = d.currency?.sign ?? d.currencyCode ?? "$";
  if (d.minbudget != null && d.maxbudget != null) return `${sign}${d.minbudget} – ${sign}${d.maxbudget}`;
  if (d.minbudget != null) return `${sign}${d.minbudget}+`;
  return undefined;
}

function formatVerification(s: WsProjectData["client_status"]): string | undefined {
  if (!s) return undefined;
  const v = "✅", x = "❌";
  return [
    `🪪 ${s.identity_verified ? v : x}`,
    `💰 ${s.payment_verified ? v : x}`,
    `💳 ${s.deposit_made ? v : x}`,
    `✉️ ${s.email_verified ? v : x}`,
    `📞 ${s.phone_verified ? v : x}`,
    `📘 ${s.facebook_connected ? v : x}`,
    `👤 ${s.profile_complete ? v : x}`,
  ].join(" ");
}

function formatCompletion(d: WsProjectData): string | undefined {
  const reviews = d.reviews ?? 0;
  const completed = d.completedProjects ?? 0;
  const ratio = reviews === 0 ? "∞" : (completed / reviews).toFixed(2);
  return `⭐ ${reviews} / 📁 ${completed} (${ratio})`;
}

// ---------------------------------------------------------------------------
// Project quality score
// ---------------------------------------------------------------------------

const VALUABLE_COUNTRIES = new Set([
  "US", "CA",
  "GB", "DE", "FR", "ES", "IT", "NL", "CH", "SE",
  "NO", "DK", "FI", "AT", "BE", "IE", "PT",
  "AU", "NZ",
]);

const AFRICA_ASIA_COUNTRIES = new Set([
  "IN", "PK", "BD", "NP", "LK", "MM", "KH", "VN", "TH", "MY", "ID", "PH",
  "CN", "JP", "KR", "TW", "HK", "SG", "MN", "KZ", "UZ", "TJ", "KG", "TM",
  "AF", "IR", "IQ", "SY", "YE", "JO", "LB", "SA", "AE", "KW", "QA", "BH", "OM",
  "NG", "GH", "KE", "ET", "TZ", "UG", "ZW", "ZA", "EG", "MA", "TN", "DZ",
  "SD", "LY", "CM", "CI", "SN", "ML", "BF", "NE", "TD", "MZ", "ZM", "AO",
  "RW", "BI", "MW", "MG", "SO", "ER", "DJ", "GM", "GN", "SL", "LR", "BJ",
  "TG", "GW", "CV", "ST", "MR", "NA", "BW", "LS", "SZ",
]);

type ScoreResult = { score: number; cool: boolean; breakdown: string[] };

function scoreProject(d: WsProjectData): ScoreResult {
  let score = 0;
  const breakdown: string[] = [];
  const countryCode = (d.currency?.country ?? "").toUpperCase();

  // +30: Budget ≥ $500 USD equivalent
  const exchangeRate = parseFloat(d.currency?.exchangerate ?? "1") || 1;
  const budgetUsd = (d.maxbudget ?? d.minbudget ?? 0) * exchangeRate;
  if (budgetUsd >= 500) {
    score += 30;
    breakdown.push("+30 budget≥$500");
  }

  // +10: Project posted within last 3 days (proxy for new/active client)
  if (d.submitDate) {
    const submitted = new Date(d.submitDate).getTime();
    const daysDiff = (Date.now() - submitted) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 3) {
      score += 10;
      breakdown.push("+10 new(<3d)");
    }
  }

  // +10: Valuable country
  if (countryCode && VALUABLE_COUNTRIES.has(countryCode)) {
    score += 10;
    breakdown.push(`+10 country(${countryCode})`);
  }

  // +10: Project has NDA / Sealed / IP / Private badge
  if (d.NDA || d.sealed || d.ip_contract || d.nonpublic || d.hideBids) {
    score += 10;
    breakdown.push("+10 badge");
  }

  // +10: Completion ratio (total projects / reviews) < 3
  const reviews = d.reviews ?? 0;
  const completed = d.completedProjects ?? 0;
  const ratio = reviews === 0 ? Infinity : completed / reviews;
  if (ratio < 3) {
    score += 10;
    breakdown.push(`+10 ratio<3`);
  }

  // -5: Client has ID verified
  if (d.client_status?.identity_verified) {
    score -= 5;
    breakdown.push("-5 ID verified");
  }

  // -10: Client has more than 20 reviews
  if (reviews > 20) {
    score -= 10;
    breakdown.push(`-10 reviews>20`);
  }

  // -5: Africa or Asia country
  if (countryCode && AFRICA_ASIA_COUNTRIES.has(countryCode)) {
    score -= 5;
    breakdown.push(`-5 Africa/Asia`);
  }

  // US threshold is stricter: >61, others >50
  const threshold = countryCode === "US" ? 61 : 49;
  const cool = score > threshold;

  return { score, cool, breakdown };
}

function countryFromData(d: WsProjectData): string | undefined {
  // Only use currency.country (2-letter ISO) — it's the client's actual country
  const code = (d.currency?.country ?? "").toUpperCase().trim();
  if (!code) return undefined;

  // Map 2-letter ISO → flag emoji + country name
  const byIso: Record<string, [string, string]> = {
    US: ["🇺🇸", "United States"], GB: ["🇬🇧", "United Kingdom"], IN: ["🇮🇳", "India"],
    AU: ["🇦🇺", "Australia"], CA: ["🇨🇦", "Canada"], DE: ["🇩🇪", "Germany"],
    FR: ["🇫🇷", "France"], PK: ["🇵🇰", "Pakistan"], BD: ["🇧🇩", "Bangladesh"],
    PH: ["🇵🇭", "Philippines"], NG: ["🇳🇬", "Nigeria"], ID: ["🇮🇩", "Indonesia"],
    BR: ["🇧🇷", "Brazil"], CN: ["🇨🇳", "China"], UA: ["🇺🇦", "Ukraine"],
    RU: ["🇷🇺", "Russia"], PL: ["🇵🇱", "Poland"], RO: ["🇷🇴", "Romania"],
    EG: ["🇪🇬", "Egypt"], KE: ["🇰🇪", "Kenya"], GH: ["🇬🇭", "Ghana"],
    ZA: ["🇿🇦", "South Africa"], AR: ["🇦🇷", "Argentina"], MX: ["🇲🇽", "Mexico"],
    CO: ["🇨🇴", "Colombia"], CL: ["🇨🇱", "Chile"], ES: ["🇪🇸", "Spain"],
    IT: ["🇮🇹", "Italy"], NL: ["🇳🇱", "Netherlands"], PT: ["🇵🇹", "Portugal"],
    TR: ["🇹🇷", "Turkey"], IL: ["🇮🇱", "Israel"], SA: ["🇸🇦", "Saudi Arabia"],
    AE: ["🇦🇪", "UAE"], SG: ["🇸🇬", "Singapore"], MY: ["🇲🇾", "Malaysia"],
    TH: ["🇹🇭", "Thailand"], VN: ["🇻🇳", "Vietnam"], JP: ["🇯🇵", "Japan"],
    KR: ["🇰🇷", "South Korea"], NZ: ["🇳🇿", "New Zealand"], IE: ["🇮🇪", "Ireland"],
    SE: ["🇸🇪", "Sweden"], NO: ["🇳🇴", "Norway"], DK: ["🇩🇰", "Denmark"],
    FI: ["🇫🇮", "Finland"], CH: ["🇨🇭", "Switzerland"], AT: ["🇦🇹", "Austria"],
    BE: ["🇧🇪", "Belgium"], GR: ["🇬🇷", "Greece"], LK: ["🇱🇰", "Sri Lanka"],
    NP: ["🇳🇵", "Nepal"], MA: ["🇲🇦", "Morocco"], HK: ["🇭🇰", "Hong Kong"],
    TW: ["🇹🇼", "Taiwan"], MM: ["🇲🇲", "Myanmar"], KH: ["🇰🇭", "Cambodia"],
    ET: ["🇪🇹", "Ethiopia"], TZ: ["🇹🇿", "Tanzania"], UG: ["🇺🇬", "Uganda"],
    ZW: ["🇿🇼", "Zimbabwe"], PE: ["🇵🇪", "Peru"], VE: ["🇻🇪", "Venezuela"],
    EC: ["🇪🇨", "Ecuador"], BO: ["🇧🇴", "Bolivia"], CZ: ["🇨🇿", "Czech Republic"],
    HU: ["🇭🇺", "Hungary"], SK: ["🇸🇰", "Slovakia"], HR: ["🇭🇷", "Croatia"],
    RS: ["🇷🇸", "Serbia"], BG: ["🇧🇬", "Bulgaria"], LT: ["🇱🇹", "Lithuania"],
    LV: ["🇱🇻", "Latvia"], EE: ["🇪🇪", "Estonia"], SI: ["🇸🇮", "Slovenia"],
    IQ: ["🇮🇶", "Iraq"], IR: ["🇮🇷", "Iran"], JO: ["🇯🇴", "Jordan"],
    LB: ["🇱🇧", "Lebanon"], KW: ["🇰🇼", "Kuwait"], QA: ["🇶🇦", "Qatar"],
    BH: ["🇧🇭", "Bahrain"], OM: ["🇴🇲", "Oman"], YE: ["🇾🇪", "Yemen"],
    AF: ["🇦🇫", "Afghanistan"], GT: ["🇬🇹", "Guatemala"], HN: ["🇭🇳", "Honduras"],
    SV: ["🇸🇻", "El Salvador"], CR: ["🇨🇷", "Costa Rica"], PA: ["🇵🇦", "Panama"],
    DO: ["🇩🇴", "Dominican Republic"], CU: ["🇨🇺", "Cuba"], JM: ["🇯🇲", "Jamaica"],
    UY: ["🇺🇾", "Uruguay"], PY: ["🇵🇾", "Paraguay"], DZ: ["🇩🇿", "Algeria"],
    TN: ["🇹🇳", "Tunisia"], LY: ["🇱🇾", "Libya"], SD: ["🇸🇩", "Sudan"],
    CM: ["🇨🇲", "Cameroon"], CI: ["🇨🇮", "Ivory Coast"], SN: ["🇸🇳", "Senegal"],
    KZ: ["🇰🇿", "Kazakhstan"], UZ: ["🇺🇿", "Uzbekistan"], AZ: ["🇦🇿", "Azerbaijan"],
    GE: ["🇬🇪", "Georgia"], AM: ["🇦🇲", "Armenia"], BY: ["🇧🇾", "Belarus"],
    MD: ["🇲🇩", "Moldova"], MK: ["🇲🇰", "North Macedonia"], AL: ["🇦🇱", "Albania"],
    BA: ["🇧🇦", "Bosnia"], ME: ["🇲🇪", "Montenegro"], XK: ["🇽🇰", "Kosovo"],
    CY: ["🇨🇾", "Cyprus"], MT: ["🇲🇹", "Malta"], LU: ["🇱🇺", "Luxembourg"],
    IS: ["🇮🇸", "Iceland"], LI: ["🇱🇮", "Liechtenstein"],
    MN: ["🇲🇳", "Mongolia"], KP: ["🇰🇵", "North Korea"], LA: ["🇱🇦", "Laos"],
    BN: ["🇧🇳", "Brunei"], TL: ["🇹🇱", "Timor-Leste"], PG: ["🇵🇬", "Papua New Guinea"],
    FJ: ["🇫🇯", "Fiji"], WS: ["🇼🇸", "Samoa"], TO: ["🇹🇴", "Tonga"],
  };

  const entry = byIso[code];
  if (entry) return `${entry[0]} ${entry[1]}`;

  // Unknown code — show globe + code
  return `🌍 ${code}`;
}

function wsDataToProject(d: WsProjectData, complete?: number, incomplete?: number): Project {
  const seoUrl = String(d.seo_url);
  const url = seoUrl.startsWith("http")
    ? seoUrl
    : `${BASE_URL}/projects/${seoUrl}`;

  const skills = d.jobs_details?.map(j => j.name) ??
    d.jobString?.split(",").map(s => s.trim()).filter(Boolean) ?? [];

  const bidCount = typeof d.bid_stats?.bid_count === "number"
    ? String(d.bid_stats.bid_count)
    : undefined;

  const country = countryFromData(d);
  const { score, cool } = scoreProject(d);
  const scoreText = `${cool ? "🎅" : "😎"} ${score}/70`;

  // Completion rate: complete / (complete + incomplete) from users API
  let completionRateText: string;
  if (complete != null && incomplete != null) {
    const total = complete + incomplete;
    const rate = complete === 0 ? "∞" : (total / complete).toFixed(2);
    completionRateText = `✅ ${complete} / ❌ ${incomplete} (${rate})`;
  } else {
    const reviews = d.reviews ?? 0;
    const completed = d.completedProjects ?? 0;
    const ratio = reviews === 0 ? "∞" : (completed / reviews).toFixed(2);
    completionRateText = `⭐ ${reviews} reviews / 📁 ${completed} (${ratio})`;
  }

  return {
    id: String(d.id),
    title: d.title,
    url,
    description: d.appended_descr?.slice(0, 800),
    skills,
    budgetText: formatBudget(d),
    postedAtText: d.time_submitted
      ? new Date(d.time_submitted * 1000).toISOString()
      : undefined,
    clientName: d.userName,
    clientCountry: country,
    clientVerificationText: formatVerification(d.client_status),
    completionRateText,
    proposalsText: bidCount,
    scoreText,
  };
}

// ---------------------------------------------------------------------------
// Auth extraction via Puppeteer
// ---------------------------------------------------------------------------

async function extractAuthFromBrowser(opts: {
  email: string;
  password: string;
  jobIds: number[];
  languages: string[];
}): Promise<{ hash2: string; userId: number; cookies: SavedCookie[] }> {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: process.env.HEADLESS !== "false", // headless by default, set HEADLESS=false to see browser
      args: ["--no-sandbox", "--disable-setuid-sandbox",
             "--disable-blink-features=AutomationControlled",
             "--disable-dev-shm-usage", "--window-size=1280,800",
             "--disable-gpu"],
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // Restore or create session
    const session = await loadSession();
    if (session && Date.now() - session.savedAt < 1000 * 60 * 60 * 24 * 30) {
      console.log("[ws] Restoring saved session...");
      await page.setCookie(...session.cookies);
      setSessionCookies(session.cookies);
      await page.goto(`${BASE_URL}/api/users/0.1/self/?compact=true`, {
        waitUntil: "domcontentloaded", timeout: 15000,
      }).catch(() => {});

      const valid = await page.evaluate(async () => {
        const r = await fetch("/api/users/0.1/self/?compact=true");
        const d = await r.json() as { status: string; result?: { username?: string } };
        return d.status === "success";
      }).catch(() => false);

      if (valid) {
        console.log("[ws] Session valid.");
        // Save refreshed cookies to extend expiry
        const refreshedCookies = await page.cookies();
        await saveSession(refreshedCookies);
        setSessionCookies(refreshedCookies);
      } else {
        console.log("[ws] Session expired, logging in...");
        await login(page, opts.email, opts.password);
      }
    } else {
      await login(page, opts.email, opts.password);
    }

    // Navigate to search page and capture the WS auth hash
    const searchUrl = new URL(`${BASE_URL}/search/projects`);
    searchUrl.searchParams.set("projectSkills", opts.jobIds.join(","));
    searchUrl.searchParams.set("projectLanguages", opts.languages.join(","));

    console.log("[ws] Capturing auth hash from browser...");

    let hash2 = "";
    let userId = 0;

    // Navigate to search page
    await page.goto(searchUrl.toString(), {
      waitUntil: "domcontentloaded", timeout: 60000,
    }).catch(() => {});

    // Wait for Angular and WebSocket to initialize
    await new Promise(r => setTimeout(r, 8000));

    // Extract auth hash directly from the page's WebSocket connection
    const authData = await page.evaluate(`
      (function() {
        // Try to get the hash from the GETAFREE_AUTH_HASH_V2 cookie
        // which is the source of the hash2 value
        var cookies = document.cookie.split(';');
        var authHash = null;
        var userId = null;
        for (var i = 0; i < cookies.length; i++) {
          var c = cookies[i].trim();
          if (c.startsWith('GETAFREE_AUTH_HASH_V2=')) {
            authHash = decodeURIComponent(c.slice('GETAFREE_AUTH_HASH_V2='.length));
          }
          if (c.startsWith('GETAFREE_USER_ID=')) {
            userId = parseInt(c.slice('GETAFREE_USER_ID='.length));
          }
        }
        return { authHash: authHash, userId: userId };
      })()
    `) as { authHash: string | null; userId: number | null };

    if (authData.authHash && authData.userId) {
      hash2 = authData.authHash;
      userId = authData.userId;
      console.log(`[ws] Auth from cookie: userId=${userId}`);
    }

    // If cookie approach failed, try CDP to capture WS frame
    if (!hash2) {
      console.log("[ws] Cookie approach failed, trying CDP frame capture...");
      const cdp = await page.createCDPSession();
      await cdp.send("Network.enable");

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 20000);
        cdp.on("Network.webSocketFrameSent", (e) => {
          const payload = e.response.payloadData;
          if (!payload) return;
          try {
            const msgs = JSON.parse(payload) as string[];
            for (const raw of msgs) {
              const msg = JSON.parse(raw) as { channel: string; body: { hash2?: string; user_id?: number } };
              if (msg.channel === "auth" && msg.body.hash2) {
                hash2 = msg.body.hash2;
                userId = msg.body.user_id ?? 0;
                console.log("[ws] Auth hash captured from WS frame.");
                clearTimeout(timeout);
                resolve();
              }
            }
          } catch { /* ignore */ }
        });

        // Re-navigate to trigger a new WS connection
        page!.goto(searchUrl.toString(), {
          waitUntil: "domcontentloaded", timeout: 30000,
        }).catch(() => {});
      });
    }

    if (!hash2) {
      throw new Error("[ws] Could not capture auth hash from browser");
    }

    const cookies = await page.cookies();
    await saveSession(cookies);
    setSessionCookies(cookies);

    return { hash2, userId, cookies };
  } finally {
    await browser?.close();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  const emailSel = 'fl-email-input input, input[type="email"], input[name="username"]';
  try {
    await page.waitForSelector(emailSel, { timeout: 40000 });
  } catch {
    const url = page.url();
    if (!url.includes("/login")) return;
    throw new Error(`[ws] Login page did not render. URL: ${url}`);
  }
  await new Promise(r => setTimeout(r, 1000));
  await page.focus(emailSel);
  await page.keyboard.type(email, { delay: 60 });
  await page.waitForSelector('fl-password-input input, input[type="password"]', { timeout: 10000 });
  await page.focus('fl-password-input input, input[type="password"]');
  await page.keyboard.type(password, { delay: 60 });
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press("Enter");
  try {
    await page.waitForFunction("!document.location.href.includes('/login')", { timeout: 60000 });
  } catch {
    console.log("[ws] Please solve any CAPTCHA in the browser window (120s)...");
    await page.waitForFunction("!document.location.href.includes('/login')", { timeout: 120000 });
  }
  await saveSession(await page.cookies());
  console.log("[ws] Login successful.");
}

// ---------------------------------------------------------------------------
// User lookup — fetch accurate country from users API
// ---------------------------------------------------------------------------

let _sessionCookieHeader = "";

function setSessionCookies(cookies: SavedCookie[]): void {
  _sessionCookieHeader = cookies
    .map(c => `${c.name}=${c.value}`)
    .join("; ");
}

async function fetchUserCountry(userId: number): Promise<{ countryCode?: string; complete?: number; incomplete?: number } | undefined> {
  if (!userId || !_sessionCookieHeader) return undefined;
  try {
    const url = `${BASE_URL}/api/users/0.1/users/?users[]=${userId}&user_details=true&user_location_details=true&user_employer_reputation=true&compact=true`;
    const res = await fetch(url, {
      headers: {
        "accept": "application/json",
        "cookie": _sessionCookieHeader,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const json = await res.json() as {
      status: string;
      result?: { users?: Record<string, {
        location?: { country?: { code?: string; name?: string } };
        employer_reputation?: { entire_history?: { complete?: number; incomplete?: number } };
      }> };
    };
    if (json.status !== "success") return undefined;
    const user = Object.values(json.result?.users ?? {})[0];
    const code = user?.location?.country?.code?.toUpperCase()
      ?? countryNameToCode(user?.location?.country?.name ?? "");
    const hist = user?.employer_reputation?.entire_history;
    return {
      countryCode: code,
      complete: hist?.complete,
      incomplete: hist?.incomplete,
    };
  } catch {
    return undefined;
  }
}

function countryNameToCode(name: string): string | undefined {
  const map: Record<string, string> = {
    "United States": "US", "United Kingdom": "GB", "India": "IN",
    "Australia": "AU", "Canada": "CA", "Germany": "DE", "France": "FR",
    "Pakistan": "PK", "Bangladesh": "BD", "Philippines": "PH",
    "Nigeria": "NG", "Indonesia": "ID", "Brazil": "BR", "China": "CN",
    "Ukraine": "UA", "Russia": "RU", "Poland": "PL", "Romania": "RO",
    "Egypt": "EG", "Kenya": "KE", "Ghana": "GH", "South Africa": "ZA",
    "Argentina": "AR", "Mexico": "MX", "Colombia": "CO", "Chile": "CL",
    "Spain": "ES", "Italy": "IT", "Netherlands": "NL", "Portugal": "PT",
    "Turkey": "TR", "Israel": "IL", "Saudi Arabia": "SA", "UAE": "AE",
    "United Arab Emirates": "AE", "Singapore": "SG", "Malaysia": "MY",
    "Thailand": "TH", "Vietnam": "VN", "Japan": "JP", "South Korea": "KR",
    "New Zealand": "NZ", "Ireland": "IE", "Sweden": "SE", "Norway": "NO",
    "Denmark": "DK", "Finland": "FI", "Switzerland": "CH", "Austria": "AT",
    "Belgium": "BE", "Greece": "GR", "Czech Republic": "CZ", "Hungary": "HU",
    "Slovakia": "SK", "Croatia": "HR", "Serbia": "RS", "Bulgaria": "BG",
    "Lithuania": "LT", "Latvia": "LV", "Estonia": "EE", "Slovenia": "SI",
    "Sri Lanka": "LK", "Nepal": "NP", "Morocco": "MA", "Hong Kong": "HK",
    "Taiwan": "TW", "Myanmar": "MM", "Cambodia": "KH", "Ethiopia": "ET",
    "Tanzania": "TZ", "Uganda": "UG", "Zimbabwe": "ZW", "Peru": "PE",
    "Venezuela": "VE", "Ecuador": "EC", "Bolivia": "BO", "Uruguay": "UY",
    "Paraguay": "PY", "Algeria": "DZ", "Tunisia": "TN", "Libya": "LY",
    "Sudan": "SD", "Cameroon": "CM", "Senegal": "SN", "Kazakhstan": "KZ",
    "Uzbekistan": "UZ", "Azerbaijan": "AZ", "Georgia": "GE", "Armenia": "AM",
    "Belarus": "BY", "Moldova": "MD", "North Macedonia": "MK", "Albania": "AL",
    "Bosnia": "BA", "Montenegro": "ME", "Cyprus": "CY", "Malta": "MT",
    "Luxembourg": "LU", "Iceland": "IS", "Iraq": "IQ", "Iran": "IR",
    "Jordan": "JO", "Lebanon": "LB", "Kuwait": "KW", "Qatar": "QA",
    "Bahrain": "BH", "Oman": "OM", "Yemen": "YE", "Afghanistan": "AF",
    "Guatemala": "GT", "Honduras": "HN", "El Salvador": "SV",
    "Costa Rica": "CR", "Panama": "PA", "Dominican Republic": "DO",
    "Cuba": "CU", "Jamaica": "JM", "Mongolia": "MN", "Mozambique": "MZ",
    "Zambia": "ZM", "Angola": "AO", "Rwanda": "RW", "Malawi": "MW",
    "Madagascar": "MG", "Somalia": "SO", "Eritrea": "ER", "Djibouti": "DJ",
    "Gambia": "GM", "Guinea": "GN", "Sierra Leone": "SL", "Liberia": "LR",
    "Benin": "BJ", "Togo": "TG", "Mali": "ML", "Burkina Faso": "BF",
    "Niger": "NE", "Chad": "TD", "Ivory Coast": "CI", "Namibia": "NA",
    "Botswana": "BW", "Lesotho": "LS", "Eswatini": "SZ",
  };
  return map[name];
}

// Countries to block — 2-letter ISO codes
const BLOCKED_COUNTRY_CODES = new Set(["IN", "PK", "BD", "NP", "NG"]);

// ---------------------------------------------------------------------------
// WsCollector — connects directly via Node.js WebSocket
// ---------------------------------------------------------------------------

export class WsCollector {
  private ws: WebSocket | null = null;
  private onProject: ((p: Project) => void) | null = null;
  private onDisconnect: ((code: number) => void) | null = null;
  private seenIds = new Set<string>();
  private seeded = false;
  private hash2 = "";
  private userId = 0;
  private readonly email: string;
  private readonly password: string;
  private readonly jobIds: number[];
  private readonly languages: string[];

  constructor(opts: {
    email: string;
    password: string;
    jobIds: number[];
    languages: string[];
  }) {
    this.email = opts.email;
    this.password = opts.password;
    this.jobIds = opts.jobIds;
    this.languages = opts.languages;
  }

  onNewProject(cb: (p: Project) => void): void {
    this.onProject = cb;
  }

  onWsDisconnect(cb: (code: number) => void): void {
    this.onDisconnect = cb;
  }

  async init(): Promise<void> {
    // Step 1: get auth hash from browser
    const auth = await extractAuthFromBrowser({
      email: this.email,
      password: this.password,
      jobIds: this.jobIds,
      languages: this.languages,
    });
    this.hash2 = auth.hash2;
    this.userId = auth.userId;
    setSessionCookies(auth.cookies);

    // Step 2: connect directly via Node.js WebSocket
    await this._connect();

    // Step 3: schedule periodic session refresh every 5 days
    this._scheduleSessionRefresh();
  }

  private _scheduleSessionRefresh(): void {
    const REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24 * 5; // 5 days
    setTimeout(async () => {
      console.log("[ws] Refreshing session proactively...");
      try {
        const auth = await extractAuthFromBrowser({
          email: this.email,
          password: this.password,
          jobIds: this.jobIds,
          languages: this.languages,
        });
        this.hash2 = auth.hash2;
        this.userId = auth.userId;
        setSessionCookies(auth.cookies);
        console.log("[ws] Session refreshed successfully.");
      } catch (e) {
        console.error("[ws] Session refresh failed:", e);
      }
      // Schedule next refresh regardless of success
      this._scheduleSessionRefresh();
    }, REFRESH_INTERVAL_MS);
    console.log("[ws] Session auto-refresh scheduled every 5 days.");
  }

  private async _connect(): Promise<void> {
    // Generate random session ID like the browser does
    const sessionId = Math.random().toString(36).slice(2, 10);
    const serverId = String(Math.floor(Math.random() * 999)).padStart(3, "0");
    const wsUrl = `${WS_BASE}/${serverId}/${sessionId}/websocket`;

    console.log("[ws] Connecting to:", wsUrl.slice(0, 60));

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          "origin": BASE_URL,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const connectTimeout = setTimeout(() => {
        // subscribe OK didn't arrive in time — subscribe anyway and continue
        console.log("[ws] Auth timeout — subscribing to channels anyway...");
        this._send({
          channel: "channels",
          body: { channels: this.jobIds },
        });
        setTimeout(() => {
          this.seeded = true;
          resolve();
          console.log("[ws] Seeding complete (fallback). Listening for new projects...");
        }, 3000);
      }, 30000);

      this.ws.on("open", () => {
        console.log("[ws] Connected.");
      });

      this.ws.on("message", (data: WebSocket.RawData) => {
        const raw = data.toString();
        if (raw === "o") {
          this._send({ channel: "auth", body: { hash2: this.hash2, user_id: this.userId } });
          return;
        }
        if (raw === "h") return;
        if (raw.startsWith("a")) {
          try {
            const msgs = JSON.parse(raw.slice(1)) as string[];
            for (const msg of msgs) {
              void this._handleMessage(msg, resolve, connectTimeout);
            }
          } catch { /* ignore */ }
        }
      });

      this.ws.on("error", (e) => {
        console.error("[ws] Error:", e.message);
      });

      this.ws.on("close", (code) => {
        console.log(`[ws] Disconnected (${code}). Reconnecting in 5s...`);
        if (this.onDisconnect) this.onDisconnect(code);
        setTimeout(() => void this._connect(), 5000);
      });
    });
  }

  private async _handleMessage(
    raw: string,
    resolve: () => void,
    connectTimeout: NodeJS.Timeout,
  ): Promise<void> {
    try {
      const msg = JSON.parse(raw) as {
        channel: string;
        body: { body?: string; data?: WsProjectData & { type?: string }; type?: string };
      };

      if (msg.channel === "subscribe" && msg.body?.body === "OK") {
        // Auth accepted — subscribe to skill channels
        this._send({
          channel: "channels",
          body: { channels: this.jobIds },
        });
        console.log(`[ws] Subscribed to ${this.jobIds.length} skill channels.`);

        // Wait 3s for initial batch then mark seeded
        setTimeout(() => {
          if (!this.seeded) {
            this.seeded = true;
            clearTimeout(connectTimeout);
            resolve();
            console.log("[ws] Seeding complete. Listening for new projects in real-time...");
          }
        }, 3000);
        return;
      }

      if (msg.channel !== "user") return;

      const data = msg.body?.data;
      if (!data) return;

      // The message type is in body.type, NOT data.type (which is project type: fixed/hourly)
      const messageType = msg.body?.type;

      // Log all project-related messages for debugging
      if (messageType && messageType !== "statusget" && !String(messageType).includes("online") && !String(messageType).includes("group")) {
        console.log(`[ws] type=${messageType} id=${data.id ?? "?"} title=${String(data.title ?? "").slice(0, 40)}`);
      }

      // Only fire callback for new projects after seeding
      if (messageType !== "projectSearchActive") return;
      if (!this.seeded) return;
      if (!data.id || !data.title) return;

      const id = String(data.id);
      if (this.seenIds.has(id)) return;
      this.seenIds.add(id);

      // Fetch accurate client country + reputation from users API (~200ms, single call)
      const userInfo = data.userId ? await fetchUserCountry(data.userId) : undefined;
      const realCountryCode = userInfo?.countryCode;

      // Override currency.country with real country code
      if (realCountryCode && data.currency) {
        data.currency.country = realCountryCode;
      } else if (realCountryCode) {
        data.currency = { country: realCountryCode };
      }

      // Inject real reputation data into WS data
      if (userInfo?.complete != null) data.completedProjects = userInfo.complete;
      if (userInfo?.incomplete != null) (data as WsProjectData & { incompleteProjects?: number }).incompleteProjects = userInfo.incomplete;

      // Filter blocked countries using real country code
      const countryCode = realCountryCode ?? data.currency?.country?.toUpperCase() ?? "";
      if (BLOCKED_COUNTRY_CODES.has(countryCode)) {
        console.log(`[ws] Filtered (country ${countryCode}): ${data.title?.slice(0, 40)}`);
        return;
      }

      const project = wsDataToProject(data, userInfo?.complete, userInfo?.incomplete);
      console.log(`[ws] 🆕 ${project.title.slice(0, 40)} | ${data.userName} | real_country=${realCountryCode ?? "?"} | shown=${project.clientCountry ?? "NONE"}`);

      if (this.onProject) {
        this.onProject(project);
      }
    } catch { /* ignore parse errors */ }
  }

  private _send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify([JSON.stringify(obj)]));
    }
  }

  markSeen(id: string): void {
    this.seenIds.add(id);
  }

  async close(): Promise<void> {
    this.ws?.close();
    this.ws = null;
  }
}
