// What the shaders show: the weather (real or previewed) and the sun's place in the sky, turned into
// the arguments of the `sky`, `land`, `precip` and `pane` effects in shaders/.
import { computed } from "vue";
import { conditionOf, intensityOf, PREVIEW_CODES, type Condition } from "./conditions";
import { app, type TimeOfDay } from "./state";

interface Sun {
  /** -1 deep night, 0 on the horizon, 1 high noon. */
  daylight: number;
  /** 0..1 across the window. */
  x: number;
}

const FIXED: Record<Exclude<TimeOfDay, "live">, Sun> = {
  dawn: { daylight: 0.04, x: 0.22 },
  day: { daylight: 0.85, x: 0.62 },
  dusk: { daylight: 0.02, x: 0.8 },
  night: { daylight: -1, x: 0.7 },
};

const TWILIGHT = 5400;

function sunAt(now: number, sunrise: number, sunset: number): Sun {
  const span = Math.max(sunset - sunrise, 1);
  if (now >= sunrise && now <= sunset) {
    const f = (now - sunrise) / span;
    const peak = Math.min(1, Math.max(0.45, span / 43200));
    return { daylight: Math.pow(Math.sin(Math.PI * f), 0.8) * peak, x: 0.18 + 0.68 * f };
  }
  const gap = now < sunrise ? sunrise - now : now - sunset;
  return { daylight: -Math.min(1, gap / TWILIGHT), x: now < sunrise ? 0.25 : 0.75 };
}

export interface Weather {
  condition: Condition;
  code: number;
  isDay: boolean;
  daylight: number;
  sun: number;
  cloud: number;
  fog: number;
  storm: number;
  rain: number;
  snow: number;
  wind: number;
}

const CLOUD: Record<Condition, number> = {
  clear: 0.1,
  partly: 0.55,
  cloudy: 0.88,
  fog: 0.5,
  drizzle: 0.82,
  rain: 0.95,
  storm: 1,
  snow: 0.85,
};

export const weather = computed<Weather>(() => {
  const f = app.forecast;
  const code = app.preview !== null ? PREVIEW_CODES[app.preview] : (f?.now.code ?? 2);
  const condition = conditionOf(code);
  const nowS = app.clock / 1000;
  const today = f?.days.find((d) => nowS < d.time + 86400) ?? f?.days[0];
  const sun =
    app.timeOfDay !== "live" ? FIXED[app.timeOfDay] : today ? sunAt(nowS, today.sunrise, today.sunset) : FIXED.dusk;
  const intensity = Math.max(intensityOf(code), condition === "drizzle" ? 0.35 : 0);
  const windKmh = f?.now.windSpeed ?? 12;
  const from = ((f?.now.windDirection ?? 270) * Math.PI) / 180;
  return {
    condition,
    code,
    isDay: sun.daylight > -0.1,
    daylight: sun.daylight,
    sun: sun.x,
    cloud: CLOUD[condition],
    fog: condition === "fog" ? 0.85 : condition === "drizzle" ? 0.15 : 0,
    storm: condition === "storm" ? 1 : 0,
    rain: condition === "rain" || condition === "drizzle" || condition === "storm" ? intensity : 0,
    snow: condition === "snow" ? intensity : 0,
    wind: Math.max(-1, Math.min(1, (-Math.sin(from) * windKmh) / 40)),
  };
});

const n = (v: number) => v.toFixed(3);
const textures = (...names: string[]) => names.map((f) => `url(assets/textures/${f})`).join(", ");
const TIMES = ["dawn", "day", "dusk", "night"];
const SKIES = textures(...TIMES.map((t) => `sky-${t}.jpg`));
const LANDS = textures(...TIMES.map((t) => `land-${t}.webp`));
const GLASS = textures("glass-normal.png", "frost.jpg");

export const shading = computed(() => {
  const w = weather.value;
  const moving = w.rain > 0 || w.snow > 0 || w.storm > 0 ? 1 : 0;
  const scene = `${n(w.daylight)}, ${n(w.sun)}, ${n(w.cloud)}, ${n(w.fog)}, ${n(w.storm)}, ${n(w.snow)}, 1`;
  return {
    sky: `sky(${SKIES}, ${scene})`,
    land: `land(${LANDS}, ${scene})`,
    precip: `precip(${n(w.rain)}, ${n(w.snow)}, ${n(w.wind)}, ${n(w.storm)}, 1)`,
    pane: `pane(22px, ${n(w.rain)}, ${n(w.snow)}, ${n(w.storm)}, ${moving}, ${GLASS})`,
  };
});
