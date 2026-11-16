export type Units = "metric" | "imperial";

const local = (time: number, offset: number) => new Date((time + offset) * 1000);
const pad = (n: number) => String(n).padStart(2, "0");

/** "07:56" in the place's own time. */
export function clock(time: number, offset: number): string {
  const d = local(time, offset);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function hourOf(time: number, offset: number): string {
  return `${pad(local(time, offset).getUTCHours())}:00`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekday(time: number, offset: number): string {
  return WEEKDAYS[local(time, offset).getUTCDay()] ?? "";
}

export function dateOf(time: number, offset: number): string {
  const d = local(time, offset);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

export const degrees = (celsius: number, units: Units) =>
  Math.round(units === "imperial" ? (celsius * 9) / 5 + 32 : celsius);

export function speed(kmh: number, units: Units): string {
  return units === "imperial" ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8] ?? "N";

export function distance(metres: number, units: Units): string {
  if (units === "imperial") {
    const miles = metres / 1609;
    return miles >= 6 ? "> 6 mi" : `${miles.toFixed(1)} mi`;
  }
  const km = metres / 1000;
  return km >= 10 ? "> 10 km" : `${km.toFixed(1)} km`;
}

export function pressure(hpa: number, units: Units): string {
  return units === "imperial" ? `${(hpa * 0.02953).toFixed(2)} inHg` : `${Math.round(hpa)} hPa`;
}

export function uvLevel(uv: number): { label: string; tone: "low" | "moderate" | "high" } {
  if (uv < 3) return { label: "Low", tone: "low" };
  if (uv < 6) return { label: "Moderate", tone: "moderate" };
  return { label: uv < 8 ? "High" : "Very high", tone: "high" };
}

export function ago(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 2) return "Just updated";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.floor(minutes / 60)} h ago`;
}
