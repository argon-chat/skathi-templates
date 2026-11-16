import { reactive, watch } from "vue";
import { CONDITIONS, type Condition } from "./conditions";
import type { Units } from "./format";
import { fetchRadar, type Radar } from "./radar";
import { AMSTERDAM, sampleForecast } from "./sample";
import { fetchForecast, type Forecast, type Place } from "./weather";

export type View = "now" | "calendar" | "map" | "charts" | "settings";
export const TIMES_OF_DAY = ["live", "dawn", "day", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

const PLACE = "weather.place";
const RECENT = "weather.recent";
const UNITS = "weather.units";

function isPlace(v: unknown): v is Place {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.region === "string" &&
    typeof p.country === "string" &&
    typeof p.latitude === "number" &&
    typeof p.longitude === "number"
  );
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

const savedPlace = read(PLACE);
const savedRecent = read(RECENT);
const savedUnits = read(UNITS);

export const app = reactive({
  place: isPlace(savedPlace) ? savedPlace : AMSTERDAM,
  recent: Array.isArray(savedRecent) ? savedRecent.filter(isPlace) : [AMSTERDAM],
  units: (savedUnits === "imperial" ? "imperial" : "metric") as Units,
  forecast: null as Forecast | null,
  loading: false,
  /** Why the live forecast could not be loaded; the sample is showing meanwhile. */
  offline: null as string | null,
  view: "now" as View,
  searching: false,
  picking: false,
  /** A condition shown instead of the real one, to see each effect. */
  preview: null as Condition | null,
  timeOfDay: "live" as TimeOfDay,
  cycling: false,
  clock: Date.now(),
  radar: null as Radar | null,
});

watch(
  () => app.units,
  (units) => localStorage.setItem(UNITS, JSON.stringify(units)),
);

let pending: AbortController | null = null;

export async function load(place: Place = app.place): Promise<void> {
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  app.loading = true;
  try {
    app.forecast = await fetchForecast(place, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    app.offline = null;
  } catch (e) {
    if (controller.signal.aborted) return;
    app.offline = e instanceof Error ? e.message : String(e);
    app.forecast = sampleForecast(place);
  } finally {
    if (pending === controller) app.loading = false;
  }
}

export function choose(place: Place): void {
  app.place = place;
  const same = (p: Place) => p.latitude === place.latitude && p.longitude === place.longitude;
  app.recent = [place, ...app.recent.filter((p) => !same(p))].slice(0, 6);
  localStorage.setItem(PLACE, JSON.stringify(place));
  localStorage.setItem(RECENT, JSON.stringify(app.recent));
  app.searching = false;
  void load(place);
}

/** Steps the preview through every condition. */
export function nextPreview(): void {
  const at = app.preview === null ? -1 : CONDITIONS.indexOf(app.preview);
  app.preview = CONDITIONS[(at + 1) % CONDITIONS.length] ?? null;
}

let cycle: ReturnType<typeof setInterval> | undefined;
watch(
  () => app.cycling,
  (on) => {
    clearInterval(cycle);
    if (on) {
      nextPreview();
      cycle = setInterval(nextPreview, 7000);
    }
  },
);

async function loadRadar(): Promise<void> {
  try {
    app.radar = await fetchRadar(AbortSignal.timeout(15000));
  } catch {
    app.radar = null;
  }
}

export function start(): () => void {
  void load();
  void loadRadar();
  const tick = setInterval(() => (app.clock = Date.now()), 30_000);
  const refresh = setInterval(() => void load(), 15 * 60_000);
  const radar = setInterval(() => void loadRadar(), 10 * 60_000);
  return () => {
    clearInterval(tick);
    clearInterval(refresh);
    clearInterval(radar);
    clearInterval(cycle);
  };
}
