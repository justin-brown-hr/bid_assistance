/** Login/CAPTCHA requires a visible browser unless LOGIN_HEADLESS=true (e.g. VPS with Xvfb). */
export function isLoginHeadless(): boolean {
  return process.env.LOGIN_HEADLESS === "true";
}

export const LOGIN_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--window-size=1280,800",
] as const;
