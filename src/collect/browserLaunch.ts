/**
 * Login/CAPTCHA prefers a visible browser locally.
 * On headless servers (no DISPLAY), always use headless Chrome — visible mode cannot start.
 * Override with LOGIN_HEADLESS=true|false only when a display is available.
 */
export function isLoginHeadless(): boolean {
  const noDisplay =
    process.platform !== "win32" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY;

  // No GUI available — visible Chrome will fail with Missing X server / $DISPLAY.
  if (noDisplay) return true;

  const explicit = process.env.LOGIN_HEADLESS;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return false;
}

export const LOGIN_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--window-size=1280,800",
] as const;
