// RainViewer's free radar (https://www.rainviewer.com/api.html): the past two hours of rain in
// 10-minute frames, as map tiles up to zoom 7. No key; the credit must be shown with a link.
// The base map is OpenStreetMap's standard tiles, credited the same way.

export interface RadarFrame {
  time: number;
  path: string;
}

export interface Radar {
  host: string;
  frames: RadarFrame[];
}

export const RADAR_MAX_ZOOM = 7;
export const TILE = 256;

export async function fetchRadar(signal?: AbortSignal): Promise<Radar> {
  const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", signal ? { signal } : {});
  if (!res.ok) throw new Error(`RainViewer answered ${res.status}`);
  const root: unknown = await res.json();
  if (typeof root !== "object" || root === null) throw new Error("RainViewer sent no maps");
  const { host, radar } = root as { host?: unknown; radar?: unknown };
  const past = typeof radar === "object" && radar !== null ? (radar as { past?: unknown }).past : undefined;
  if (typeof host !== "string" || !Array.isArray(past)) throw new Error("RainViewer sent no radar frames");
  const frames = past.flatMap((f: unknown) => {
    if (typeof f !== "object" || f === null) return [];
    const { time, path } = f as { time?: unknown; path?: unknown };
    return typeof time === "number" && typeof path === "string" ? [{ time, path }] : [];
  });
  return { host, frames };
}

/** The world pixel (at `zoom`, 256-pixel tiles) of a latitude and longitude, Web Mercator. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

export interface Tile {
  key: string;
  x: number;
  y: number;
}

/** A sheet of whole tiles, `columns` wide, whose top left sits at (`left`, `top`) in the view. */
export interface Sheet {
  tiles: Tile[];
  columns: number;
  left: number;
  top: number;
}

/** The tiles that cover a `width` × `height` view centred on a world pixel. */
export function tilesAround(centre: { x: number; y: number }, width: number, height: number, zoom: number): Sheet {
  const count = 2 ** zoom;
  const left = centre.x - width / 2;
  const top = centre.y - height / 2;
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor((left + width) / TILE);
  const y0 = Math.floor(top / TILE);
  const y1 = Math.floor((top + height) / TILE);
  const tiles: Tile[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const x = ((tx % count) + count) % count;
      const y = Math.max(0, Math.min(count - 1, ty));
      tiles.push({ key: `${tx}/${ty}`, x, y });
    }
  }
  return { tiles, columns: x1 - x0 + 1, left: x0 * TILE - left, top: y0 * TILE - top };
}

export const mapTile = (t: Tile, zoom: number) => `https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`;

export const radarTile = (radar: Radar, frame: RadarFrame, t: Tile, zoom: number) =>
  `${radar.host}${frame.path}/${TILE}/${zoom}/${t.x}/${t.y}/2/1_1.png`;
