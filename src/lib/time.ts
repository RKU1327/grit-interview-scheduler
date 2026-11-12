import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** The single display time zone for the demo. Storage is always UTC. */
export const TZ = "Asia/Kolkata";
export const TZ_LABEL = "IST";
export const TZ_LONG = "India Standard Time (Asia/Kolkata, UTC+05:30)";

export const iso = (d: Date) => d.toISOString();

/** yyyy-MM-dd calendar day in IST for an instant. */
export const dayKey = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "yyyy-MM-dd");

export const isDayKey = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export const isHm = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Convert an IST wall-clock day + HH:mm to the UTC instant. */
export const zonedToUtc = (day: string, hm: string) => fromZonedTime(`${day}T${hm}:00`, TZ);

/** UTC instants bounding an IST calendar day: [start, end). */
export function dayRange(day: string) {
  const start = zonedToUtc(day, "00:00");
  return { start, end: addDays(start, 1) };
}

export const shiftDay = (day: string, delta: number) => dayKey(addDays(zonedToUtc(day, "12:00"), delta));

export const fmtTime = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "h:mm a");
export const fmtHm = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "HH:mm");
export const fmtDate = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "d MMM yyyy");
export const fmtDateLong = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "EEEE, d MMMM yyyy");
export const fmtDayShort = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "EEE d MMM");
export const fmtDateTime = (d: Date | string) =>
  `${formatInTimeZone(new Date(d), TZ, "EEE, d MMM yyyy · h:mm a")} ${TZ_LABEL}`;
export const fmtStamp = (d: Date | string) => `${formatInTimeZone(new Date(d), TZ, "d MMM yyyy, h:mm a")} ${TZ_LABEL}`;
export const fmtRange = (start: Date | string, end: Date | string) =>
  `${fmtTime(start)} – ${fmtTime(end)} ${TZ_LABEL}`;

export function relativeDayLabel(d: Date | string, now: Date) {
  const key = dayKey(d);
  const today = dayKey(now);
  if (key === today) return "Today";
  if (key === shiftDay(today, 1)) return "Tomorrow";
  if (key === shiftDay(today, -1)) return "Yesterday";
  return fmtDayShort(d);
}

export { addDays, addMinutes };
