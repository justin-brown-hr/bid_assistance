import type { Page } from "puppeteer-core";
import { FL_BASE_URL, saveFlSession } from "./flSession.js";
import { isLoginHeadless } from "./browserLaunch.js";

async function isLoggedInOnPage(page: Page): Promise<boolean> {
  try {
    const r = await page.evaluate(async () => {
      const res = await fetch("/api/users/0.1/self/?compact=true");
      const d = await res.json() as { status: string; result?: { username?: string } };
      return d.status === "success" && Boolean(d.result?.username);
    });
    return r;
  } catch {
    return false;
  }
}

export async function flLogin(page: Page, email: string, password: string, tag = "fl"): Promise<void> {
  await page.goto(`${FL_BASE_URL}/login`, { waitUntil: "networkidle2", timeout: 60000 });

  if (await isLoggedInOnPage(page)) {
    console.log(`[${tag}] Already logged in — skipping login form.`);
    await saveFlSession(await page.cookies());
    return;
  }

  const emailSel = 'fl-email-input input, input[type="email"], input[name="username"]';
  try {
    await page.waitForSelector(emailSel, { timeout: 15000 });
  } catch {
    const url = page.url();
    if (!url.includes("/login")) {
      if (await isLoggedInOnPage(page)) {
        console.log(`[${tag}] Redirected — already logged in.`);
        await saveFlSession(await page.cookies());
        return;
      }
    }
    throw new Error(`[${tag}] Login page did not render. URL: ${url}`);
  }

  await new Promise((r) => setTimeout(r, 1000));
  await page.focus(emailSel);
  await page.keyboard.type(email, { delay: 60 });
  await page.waitForSelector('fl-password-input input, input[type="password"]', { timeout: 10000 });
  await page.focus('fl-password-input input, input[type="password"]');
  await page.keyboard.type(password, { delay: 60 });
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press("Enter");

  try {
    await page.waitForFunction("!document.location.href.includes('/login')", { timeout: 60000 });
  } catch {
    const maxMs = Number(process.env.CAPTCHA_WAIT_MS ?? "0");
    const headless = isLoginHeadless();
    const allowLongWait = !headless;
    const effectiveMaxMs = (allowLongWait && maxMs <= 0) ? 30 * 60 * 1000 : maxMs;

    if (headless) {
      console.log(
        `[${tag}] CAPTCHA likely required but browser is headless. ` +
        "Set LOGIN_HEADLESS=false to open visible Chrome.",
      );
    }
    console.log(
      `[${tag}] CAPTCHA likely required. Solve it in the browser window.` +
      (effectiveMaxMs > 0 ? ` Waiting up to ${Math.round(effectiveMaxMs / 60000)} min...` : " Waiting indefinitely..."),
    );

    const start = Date.now();
    while (true) {
      const elapsed = Date.now() - start;
      if (effectiveMaxMs > 0 && elapsed >= effectiveMaxMs) {
        throw new Error(`[${tag}] CAPTCHA not solved within ${Math.round(effectiveMaxMs / 60000)} minutes`);
      }
      const remaining = effectiveMaxMs > 0 ? Math.max(0, effectiveMaxMs - elapsed) : 5 * 60 * 1000;
      const chunkMs = Math.min(5 * 60 * 1000, remaining || 5 * 60 * 1000);
      try {
        await page.waitForFunction("!document.location.href.includes('/login')", { timeout: chunkMs });
        break;
      } catch {
        console.log(`[${tag}] Still on login page — waiting for CAPTCHA/verification...`);
      }
    }
  }

  await saveFlSession(await page.cookies());
  console.log(`[${tag}] Login successful.`);
}
