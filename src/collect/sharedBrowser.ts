import puppeteer, { type Browser, type Page } from "puppeteer-core";
import path from "node:path";
import { isLoginHeadless, LOGIN_BROWSER_ARGS } from "./browserLaunch.js";
import { flLogin } from "./flLogin.js";
import {
  loadFlSession,
  saveFlSession,
  type SavedCookie,
  verifyFlSessionCookies,
  waitForValidFlSession,
} from "./flSession.js";

const CHROME_PATH = process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "/usr/bin/google-chrome-stable";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

class SharedBrowser {
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;
  private loginPromise: Promise<void> | null = null;

  private async launch(): Promise<Browser> {
    const headless = isLoginHeadless();
    console.log(
      headless
        ? "[browser] Launching shared headless Chrome..."
        : "[browser] Launching shared visible Chrome...",
    );
    this.browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless,
      args: [...LOGIN_BROWSER_ARGS, ...(headless ? ["--disable-gpu"] : [])],
    });
    return this.browser;
  }

  /** Get or create the single shared Chrome instance (kept open for new tabs). */
  async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launchPromise) return this.launchPromise;
    this.launchPromise = this.launch();
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  /** Attach a browser opened elsewhere (e.g. ws login) — keeps it alive. */
  attach(browser: Browser): void {
    this.browser = browser;
  }

  private async configurePage(page: Page, cookies?: SavedCookie[]): Promise<void> {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    if (cookies?.length) {
      await page.setCookie(...cookies);
    }
  }

  /** Open a new tab with session cookies applied. Caller closes the tab when done. */
  async newTab(cookies?: SavedCookie[]): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const session = cookies ?? (await loadFlSession())?.cookies;
    await this.configurePage(page, session);
    return page;
  }

  /** Ensure valid session — wait for ws login, or run login once in shared browser. */
  async ensureSession(email: string, password: string, tag = "browser"): Promise<SavedCookie[]> {
    const existing = await loadFlSession();
    if (existing?.cookies?.length && await verifyFlSessionCookies(existing.cookies)) {
      return existing.cookies;
    }

    try {
      return await waitForValidFlSession(15 * 60 * 1000);
    } catch {
      // ws not logging in — login ourselves once (mutexed)
    }

    if (!this.loginPromise) {
      this.loginPromise = this.doLogin(email, password, tag).finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;

    const session = await loadFlSession();
    if (!session?.cookies?.length || !await verifyFlSessionCookies(session.cookies)) {
      throw new Error(`[${tag}] Login completed but session is still invalid`);
    }
    return session.cookies;
  }

  private async doLogin(email: string, password: string, tag: string): Promise<void> {
    console.log(`[${tag}] Starting login in shared Chrome...`);
    const page = await this.newTab();
    try {
      await flLogin(page, email, password, tag);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async refreshSessionFromBrowser(): Promise<void> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();
    const page = pages[0];
    if (page) {
      await saveFlSession(await page.cookies());
    }
  }

  async close(): Promise<void> {
    try { await this.browser?.close(); } catch { /* ignore */ }
    this.browser = null;
    this.loginPromise = null;
  }
}

export const sharedBrowser = new SharedBrowser();
