// WMO weather interpretation codes, as Open-Meteo reports them.

export const CONDITIONS = ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "storm", "snow"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_NAMES: Record<Condition, string> = {
  clear: "Clear",
  partly: "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  storm: "Thunderstorm",
  snow: "Snow",
};

export function conditionOf(code: number): Condition {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}

const LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mostly Clear",
  2: "Partly Cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Freezing Fog",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  56: "Freezing Drizzle",
  57: "Freezing Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Showers",
  81: "Rain Showers",
  82: "Heavy Showers",
  85: "Snow Showers",
  86: "Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

export function labelOf(code: number, isDay = true): string {
  if (code === 0 && isDay) return "Sunny";
  return LABELS[code] ?? CONDITION_NAMES[conditionOf(code)];
}

/** A representative code, for previewing a condition. */
export const PREVIEW_CODES: Record<Condition, number> = {
  clear: 0,
  partly: 2,
  cloudy: 3,
  fog: 45,
  drizzle: 53,
  rain: 63,
  storm: 95,
  snow: 73,
};

/** How hard it rains or snows for a code, 0..1. */
export function intensityOf(code: number): number {
  if ([51, 56, 61, 71, 80, 85].includes(code)) return 0.45;
  if ([53, 63, 73, 81, 86, 66, 77].includes(code)) return 0.7;
  if ([55, 57, 65, 67, 75, 82].includes(code)) return 0.95;
  if (code >= 95) return 1;
  return 0;
}
