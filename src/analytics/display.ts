import { jstAnalyticsDate } from "./japanDay.js";

function normalizeJstHour(hour: number): number {
  if (hour === 24) return 0;
  return hour;
}

/** Display label for analytics When column (JST, 05:00 day boundary). */
export function formatAnalyticsWhen(ms: number): string {
  if (!ms) return "—";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    let year = Number(get("year"));
    let month = Number(get("month"));
    let day = Number(get("day"));
    const hour = normalizeJstHour(Number(get("hour")));
    const minute = get("minute");
    const analytics = jstAnalyticsDate(ms);
    year = analytics.year;
    month = analytics.month;
    day = analytics.day;
    const monthLabel = new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    return `${monthLabel} ${day}, ${year} ${String(hour).padStart(2, "0")}:${minute}`;
  } catch {
    return "—";
  }
}

export function analyticsProjectDetailUrl(row: {
  projectId: string;
  projectUrl?: string | null;
}): string {
  const rawUrl = String(row.projectUrl ?? "").trim();
  if (rawUrl && !rawUrl.startsWith("manual:")) {
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    if (rawUrl.startsWith("/")) return `https://www.freelancer.com${rawUrl}`;
    if (/freelancer\.com\/projects\//i.test(rawUrl)) {
      return rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl.replace(/^\/+/, "")}`;
    }
    return `https://www.freelancer.com/projects/${rawUrl.replace(/^\/+/, "")}`;
  }
  const pid = String(row.projectId ?? "").trim();
  if (!pid || pid.startsWith("manual:")) return "";
  if (/^https?:\/\//i.test(pid)) return pid;
  if (/freelancer\.com\/projects\//i.test(pid)) {
    return pid.startsWith("http") ? pid : `https://${pid.replace(/^\/+/, "")}`;
  }
  return `https://www.freelancer.com/projects/${pid.replace(/^\/+/, "")}`;
}
