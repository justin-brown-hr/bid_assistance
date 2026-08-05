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

function normalizeJstHour(hour: number): number {
  if (hour === 24) return 0;
  return hour;
}

/** Wall-clock calendar date/time in JST. */
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
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: normalizeJstHour(get("hour")),
  };
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

/** UTC ms for 05:00 JST on the given calendar Y-M-D. */
export function jstDayStartMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, DAY_START_HOUR, 0, 0) - JST_OFFSET_MS;
}

/** 05:00 JST at the start of the current analytics day for `ms`. */
export function analyticsDayStartMs(ms: number): number {
  const d = jstAnalyticsDate(ms);
  return jstDayStartMs(d.year, d.month, d.day);
}

/** 05:00 JST at the start of today's JST calendar date. */
function jstCalendarTodayStartMs(ms: number): number {
  const p = jstParts(ms);
  return jstDayStartMs(p.year, p.month, p.day);
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

/** Monday 05:00 JST for the calendar week that contains `ms`. */
function calendarWeekMondayStartMs(ms: number): number {
  const p = jstParts(ms);
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
  const daysFromMon = (dow + 6) % 7;
  const mon = addCalendarDays(p.year, p.month, p.day, -daysFromMon);
  return jstDayStartMs(mon.year, mon.month, mon.day);
}

/**
 * Period ranges use 05:00 JST boundaries on the Japan calendar:
 * - today: today 05:00 JST → tomorrow 05:00 JST
 * - yesterday: yesterday 05:00 JST → today 05:00 JST
 */
export function periodRange(period: AnalyticsPeriod, nowMs = Date.now()): { from: number; to: number } | null {
  if (period === "all") return null;
  const todayStart = jstCalendarTodayStartMs(nowMs);
  if (period === "today") {
    return { from: todayStart, to: todayStart + MS_DAY };
  }
  if (period === "yesterday") {
    return { from: todayStart - MS_DAY, to: todayStart };
  }
  if (period === "this_week") {
    const from = calendarWeekMondayStartMs(nowMs);
    return { from, to: from + 7 * MS_DAY };
  }
  if (period === "last_week") {
    const thisWeek = calendarWeekMondayStartMs(nowMs);
    return { from: thisWeek - 7 * MS_DAY, to: thisWeek };
  }
  if (period === "this_month") {
    const p = jstParts(nowMs);
    const from = jstDayStartMs(p.year, p.month, 1);
    const nextMonth = p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
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
