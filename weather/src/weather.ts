// Open-Meteo (https://open-meteo.com): forecasts and place search, free and without an API key.
// Times are Unix seconds; `offset` is the place's UTC offset, for showing them in its local time.

export interface Place {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface Now {
  time: number;
  temperature: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  visibility: number;
  uv: number;
  code: number;
  isDay: boolean;
}

export interface Hour {
  time: number;
  temperature: number;
  code: number;
  isDay: boolean;
  precipitationChance: number;
}

export interface Day {
  time: number;
  code: number;
  high: number;
  low: number;
  sunrise: number;
  sunset: number;
  precipitationChance: number;
}

export interface Forecast {
  place: Place;
  offset: number;
  now: Now;
  hours: Hour[];
  days: Day[];
  /** Precipitation in mm per 15 minutes, from now on. */
  nowcast: number[];
  fetched: number;
  sample: boolean;
}

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const SEARCH = "https://geocoding-api.open-meteo.com/v1/search";

class Shape extends Error {}

const record = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Shape(`${what} is not an object`);
  return v as Record<string, unknown>;
};
const num = (o: Record<string, unknown>, key: string): number => {
  const v = o[key];
  if (typeof v !== "number") throw new Shape(`${key} is not a number`);
  return v;
};
const nums = (o: Record<string, unknown>, key: string): number[] => {
  const v = o[key];
  if (!Array.isArray(v)) throw new Shape(`${key} is not a list`);
  return v.map((x: unknown) => (typeof x === "number" ? x : 0));
};
const str = (o: Record<string, unknown>, key: string): string => {
  const v = o[key];
  return typeof v === "string" ? v : "";
};

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`${url.split("?")[0] ?? url} answered ${res.status}`);
  return res.json();
}

export function parseForecast(json: unknown, place: Place): Forecast {
  const root = record(json, "the forecast");
  const c = record(root.current, "current");
  const h = record(root.hourly, "hourly");
  const d = record(root.daily, "daily");
  const m = root.minutely_15 === undefined ? null : record(root.minutely_15, "minutely_15");

  const hourTimes = nums(h, "time");
  const temps = nums(h, "temperature_2m");
  const codes = nums(h, "weather_code");
  const days = nums(h, "is_day");
  const chances = nums(h, "precipitation_probability");
  const dayTimes = nums(d, "time");
  const dayCodes = nums(d, "weather_code");
  const highs = nums(d, "temperature_2m_max");
  const lows = nums(d, "temperature_2m_min");
  const rises = nums(d, "sunrise");
  const sets = nums(d, "sunset");
  const dayChances = nums(d, "precipitation_probability_max");

  return {
    place,
    offset: num(root, "utc_offset_seconds"),
    now: {
      time: num(c, "time"),
      temperature: num(c, "temperature_2m"),
      feelsLike: num(c, "apparent_temperature"),
      humidity: num(c, "relative_humidity_2m"),
      pressure: num(c, "pressure_msl"),
      windSpeed: num(c, "wind_speed_10m"),
      windDirection: num(c, "wind_direction_10m"),
      visibility: num(c, "visibility"),
      uv: num(c, "uv_index"),
      code: num(c, "weather_code"),
      isDay: num(c, "is_day") === 1,
    },
    hours: hourTimes.map((time, i) => ({
      time,
      temperature: temps[i] ?? 0,
      code: codes[i] ?? 0,
      isDay: days[i] === 1,
      precipitationChance: chances[i] ?? 0,
    })),
    days: dayTimes.map((time, i) => ({
      time,
      code: dayCodes[i] ?? 0,
      high: highs[i] ?? 0,
      low: lows[i] ?? 0,
      sunrise: rises[i] ?? time,
      sunset: sets[i] ?? time,
      precipitationChance: dayChances[i] ?? 0,
    })),
    nowcast: m ? nums(m, "precipitation") : [],
    fetched: Date.now(),
    sample: false,
  };
}

export async function fetchForecast(place: Place, signal?: AbortSignal): Promise<Forecast> {
  const q = query({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,visibility,uv_index",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max",
    minutely_15: "precipitation",
    forecast_minutely_15: "8",
    forecast_hours: "25",
    forecast_days: "10",
    timezone: "auto",
    timeformat: "unixtime",
  });
  return parseForecast(await getJson(`${FORECAST}?${q}`, signal), place);
}

export async function searchPlaces(name: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query({ name, count: "8", language: "en", format: "json" });
  const root = record(await getJson(`${SEARCH}?${q}`, signal), "the search result");
  const results: unknown[] = Array.isArray(root.results) ? root.results : [];
  return results.flatMap((r: unknown) => {
    try {
      const o = record(r, "a place");
      return [
        {
          name: str(o, "name"),
          region: str(o, "admin1"),
          country: str(o, "country_code"),
          latitude: num(o, "latitude"),
          longitude: num(o, "longitude"),
        },
      ];
    } catch {
      return [];
    }
  });
}
