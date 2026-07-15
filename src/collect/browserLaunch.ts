/**
 * Login/CAPTCHA prefers a visible browser locally.
 * On headless servers (no DISPLAY), default to headless Chrome so scraping works on VPS.
 * Override with LOGIN_HEADLESS=true|false.
 */
export function isLoginHeadless(): boolean {
  const explicit = process.env.LOGIN_HEADLESS;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // Linux/VPS without a GUI — visible Chrome cannot start
  if (process.platform !== "win32" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }
  return false;
}

export const LOGIN_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--window-size=1280,800",
] as const;
