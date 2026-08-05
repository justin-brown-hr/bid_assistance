export type AnalyticsPeriod =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "all";

const TZ = "Asia/Tokyo";
const DAY_START_HOUR = 5;
const MS_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type JstParts = { year: number; month: number; day: number; hour: number };

function jstParts(ms: number): JstParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

/** Analytics calendar date in JST (day rolls at 05:00). */
export function jstAnalyticsDate(ms: number): JstParts {
  const p = jstParts(ms);
  if (p.hour < DAY_START_HOUR) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    d.setUTCDate(d.getUTCDate() - 1);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: p.hour };
  }
  return p;
}

/** UTC ms for analytics-day start (05:00 JST on given Y-M-D). */
export function jstDayStartMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, DAY_START_HOUR, 0, 0) - JST_OFFSET_MS;
}

export function analyticsDayStartMs(ms: number): number {
  const d = jstAnalyticsDate(ms);
  return jstDayStartMs(d.year, d.month, d.day);
}

function addCalendarDays(year: number, month: number, day: number, delta: number): JstParts {
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    hour: DAY_START_HOUR,
  };
}

/** Monday-based week in analytics days (JST 05:00 boundary). */
function weekMondayStartMs(ms: number): number {
  const d = jstAnalyticsDate(ms);
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day));
  const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
  const daysFromMon = (dow + 6) % 7;
  const mon = addCalendarDays(d.year, d.month, d.day, -daysFromMon);
  return jstDayStartMs(mon.year, mon.month, mon.day);
}

export function periodRange(period: AnalyticsPeriod, nowMs = Date.now()): { from: number; to: number } | null {
  if (period === "all") return null;
  const dayStart = analyticsDayStartMs(nowMs);
  if (period === "today") {
    return { from: dayStart, to: dayStart + MS_DAY };
  }
  if (period === "yesterday") {
    return { from: dayStart - MS_DAY, to: dayStart };
  }
  if (period === "this_week") {
    const from = weekMondayStartMs(nowMs);
    return { from, to: from + 7 * MS_DAY };
  }
  if (period === "last_week") {
    const thisWeek = weekMondayStartMs(nowMs);
    return { from: thisWeek - 7 * MS_DAY, to: thisWeek };
  }
  if (period === "this_month") {
    const d = jstAnalyticsDate(nowMs);
    const from = jstDayStartMs(d.year, d.month, 1);
    const nextMonth = d.month === 12 ? { year: d.year + 1, month: 1 } : { year: d.year, month: d.month + 1 };
    const to = jstDayStartMs(nextMonth.year, nextMonth.month, 1);
    return { from, to };
  }
  return null;
}

export function normalizeAnalyticsPeriod(raw: string | null | undefined): AnalyticsPeriod {
  const p = String(raw ?? "today").trim().toLowerCase();
  if (
    p === "today" || p === "yesterday" || p === "this_week" || p === "last_week"
    || p === "this_month" || p === "all"
  ) return p;
  return "today";
}
