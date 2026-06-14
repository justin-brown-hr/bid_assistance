import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const FL_BASE_URL = "https://www.freelancer.com";
export const FL_SESSION_FILE = path.join("data", "fl-session.json");

export type SavedCookie = {
  name: string; value: string; domain: string;
  path: string; expires: number; httpOnly: boolean;
  secure: boolean; sameSite?: "Strict" | "Lax" | "None";
};

export async function loadFlSession(): Promise<{ cookies: SavedCookie[]; savedAt: number } | null> {
  try { return JSON.parse(await readFile(FL_SESSION_FILE, "utf8")); }
  catch { return null; }
}

export async function saveFlSession(cookies: SavedCookie[]): Promise<void> {
  await mkdir(path.dirname(FL_SESSION_FILE), { recursive: true });
  await writeFile(FL_SESSION_FILE, JSON.stringify({ cookies, savedAt: Date.now() }, null, 2), "utf8");
}

export async function verifyFlSessionCookies(cookies: SavedCookie[]): Promise<boolean> {
  if (!cookies.length) return false;
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  try {
    const res = await fetch(`${FL_BASE_URL}/api/users/0.1/self/?compact=true`, {
      headers: {
        accept: "application/json",
        cookie: cookieHeader,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const json = await res.json() as { status: string; result?: { username?: string } };
    return json.status === "success" && Boolean(json.result?.username);
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait until ws login saves a valid session (or timeout). */
export async function waitForValidFlSession(maxMs = 15 * 60 * 1000): Promise<SavedCookie[]> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const session = await loadFlSession();
    if (session?.cookies?.length && await verifyFlSessionCookies(session.cookies)) {
      return session.cookies;
    }
    await sleep(2000);
  }
  throw new Error("[fl] Timed out waiting for a valid Freelancer session");
}
