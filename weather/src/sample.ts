import type { Forecast, Hour, Place } from "./weather";

export const AMSTERDAM: Place = {
  name: "Amsterdam",
  region: "North Holland",
  country: "NL",
  latitude: 52.374,
  longitude: 4.8897,
};

const HIGHS = [15, 14, 13, 16, 15, 13, 12, 14, 15, 16];
const LOWS = [7, 8, 6, 7, 8, 6, 5, 6, 8, 9];
const CODES = [2, 61, 3, 0, 2, 3, 63, 1, 2, 0];
const CHANCES = [10, 70, 25, 0, 10, 30, 80, 5, 10, 0];

/** A plausible autumn day, laid out around the current time, for when the forecast cannot be fetched. */
export function sampleForecast(place: Place = AMSTERDAM, nowMs = Date.now()): Forecast {
  const offset = 3600;
  const now = Math.floor(nowMs / 1000);
  const midnight = Math.floor((now + offset) / 86400) * 86400 - offset;
  const sunrise = midnight + 7 * 3600 + 56 * 60;
  const sunset = midnight + 16 * 3600 + 42 * 60;
  const temperature = (t: number) => {
    const hour = ((((t + offset) % 86400) + 86400) % 86400) / 3600;
    return 11 + 4 * Math.cos(((hour - 14.5) / 24) * 2 * Math.PI);
  };
  const isDay = (t: number) => {
    const s = (((t - sunrise) % 86400) + 86400) % 86400;
    return s < sunset - sunrise;
  };
  const first = Math.floor(now / 3600) * 3600;
  const hours: Hour[] = Array.from({ length: 25 }, (_, i) => {
    const time = first + i * 3600;
    const day = isDay(time);
    return {
      time,
      temperature: temperature(time),
      code: i > 18 ? 61 : day ? (i % 5 === 3 ? 0 : 2) : 1,
      isDay: day,
      precipitationChance: i > 18 ? 60 : 10,
    };
  });
  return {
    place,
    offset,
    now: {
      time: now,
      temperature: temperature(now),
      feelsLike: temperature(now) - 1,
      humidity: 68,
      pressure: 1018,
      windSpeed: 14,
      windDirection: 315,
      visibility: 24000,
      uv: isDay(now) ? 2 : 0,
      code: 2,
      isDay: isDay(now),
    },
    hours,
    days: HIGHS.map((high, i) => ({
      time: midnight + i * 86400,
      code: CODES[i] ?? 2,
      high,
      low: LOWS[i] ?? high - 7,
      sunrise: sunrise + i * 86400 + i * 90,
      sunset: sunset + i * 86400 - i * 100,
      precipitationChance: CHANCES[i] ?? 0,
    })),
    nowcast: [0, 0, 0.1, 0.3, 0.4, 0.2, 0.1, 0],
    fetched: nowMs,
    sample: true,
  };
}
