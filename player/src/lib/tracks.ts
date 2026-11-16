/**
 * The colours a track dresses the app in: the backdrop takes the first two, the UI and the spectrum the
 * accent, which `heat` (0..1) lets take over the spectrum's candy gradient.
 */
export interface Palette {
  first: string;
  second: string;
  accent: string;
  heat: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  source: string | File;
  /** Album art; null draws the `cover` effect from the palette instead. */
  cover: string | null;
  palette: Palette;
  duration: number | null;
}

const demo = (id: string, title: string, artist: string, album: string, palette: Palette, duration: number): Track => ({
  id,
  title,
  artist,
  album,
  source: `assets/music/${id}.ogg`,
  cover: `assets/covers/${id}.jpg`,
  palette,
  duration,
});

export const DEMO: Track[] = [
  demo(
    "neon-petals",
    "Neon Petals!!",
    "Neonbell feat. lunaecho",
    "Digital Flora EP",
    { first: "#4fc3f7", second: "#6f6cf0", accent: "#d8f55a", heat: 0.3 },
    44.6,
  ),
  demo(
    "sugar-halo",
    "Sugar Halo",
    "Mochimochi feat. skathi",
    "Sugar Halo",
    { first: "#ff9ec4", second: "#c8b6ff", accent: "#ffb3d4", heat: 0.35 },
    44.25,
  ),
  demo(
    "oh-yes",
    "Oh yes",
    "Static Lilac",
    "Channel Surf",
    { first: "#e7b7cc", second: "#b69be0", accent: "#e9d9f5", heat: 0.3 },
    43.98,
  ),
  demo(
    "skathi",
    "Skathi",
    "Lumi Wolf",
    "Aurora EP",
    { first: "#8fb0ff", second: "#c9a7f5", accent: "#f5e27a", heat: 0.3 },
    46.2,
  ),
  demo(
    "emberline",
    "Emberline",
    "Cinder Hollow",
    "Emberline · MMXXVI",
    { first: "#ff9a4d", second: "#e0502a", accent: "#ffb36b", heat: 0.55 },
    54.93,
  ),
  demo(
    "demons",
    "Demons...",
    "Hellforge Unit",
    "Demons...",
    { first: "#ff3b1f", second: "#9e1020", accent: "#ff5a2c", heat: 0.9 },
    45,
  ),
];

const CANDY: Palette[] = [
  { first: "#f7a8d0", second: "#c9a7f5", accent: "#f7a8d0", heat: 0.3 },
  { first: "#9fcdf5", second: "#c9a7f5", accent: "#9fcdf5", heat: 0.3 },
  { first: "#fbe0a0", second: "#f7a8d0", accent: "#fbe0a0", heat: 0.3 },
  { first: "#c9a7f5", second: "#9fcdf5", accent: "#c9a7f5", heat: 0.3 },
];

let added = 0;

export function fileTrack(file: File): Track {
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
  let hash = 0;
  for (const c of file.name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return {
    id: `file-${++added}-${file.name}`,
    title,
    artist: "Your music",
    album: file.name,
    source: file,
    cover: null,
    palette: CANDY[Math.abs(hash) % CANDY.length]!,
    duration: null,
  };
}

export function seedOf(id: string): number {
  let hash = 7;
  for (const c of id) hash = (hash * 17 + c.charCodeAt(0)) % 9973;
  return (hash / 9973) * 60 - 30;
}

export const AUDIO_TYPES = [".mp3", ".ogg", ".oga", ".wav", ".flac", ".m4a", ".aac", ".aif", ".aiff"];

export function clock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "–:––";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
