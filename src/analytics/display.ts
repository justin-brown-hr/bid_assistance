function normalizeJstHour(hour: number): number {
  if (hour === 24) return 0;
  return hour;
}

/** When column: actual copy time in Japan (wall-clock JST). */
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
    const year = get("year");
    const month = Number(get("month"));
    const day = Number(get("day"));
    const hour = String(normalizeJstHour(Number(get("hour")))).padStart(2, "0");
    const minute = get("minute");
    const monthLabel = new Date(Date.UTC(Number(year), month - 1, day)).toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    return `${monthLabel} ${day}, ${year} ${hour}:${minute} JST`;
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
