// 24×24 paths. The filled ones are drawn with `fill="currentColor"`, the rest as round 2px strokes.
export const icons = {
  play: "M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8c.6-.4.6-1.4 0-1.8L9.6 4.3C8.9 3.9 8 4.4 8 5.2z",
  pause: "M7 4.5h3.2v15H7z M13.8 4.5H17v15h-3.2z",
  next: "M5 5.6v12.8c0 .8.9 1.3 1.6.8l9-6.4c.6-.4.6-1.2 0-1.6l-9-6.4C5.9 4.3 5 4.8 5 5.6z M17 5h2.4v14H17z",
  prev: "M19 5.6v12.8c0 .8-.9 1.3-1.6.8l-9-6.4c-.6-.4-.6-1.2 0-1.6l9-6.4c.7-.5 1.6 0 1.6.8z M4.6 5H7v14H4.6z",
  shuffle: "M16 4h4v4 M4 20 20 4 M20 16v4h-4 M14.5 14.5 20 20 M4 4l5 5",
  repeat: "M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3",
  repeatOne: "M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3 M11 10h1.5v5",
  volume: "M11 5 6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14",
  volumeLow: "M11 5 6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7",
  mute: "M11 5 6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6",
  heart:
    "M12 20.3s-7.6-4.6-9.3-9.4C1.6 7.6 3.6 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.3 0 5.3 3.1 4.2 6.4-1.7 4.8-9.3 9.4-9.3 9.4z",
  plus: "M12 5v14 M5 12h14",
  close: "M6 6l12 12 M18 6 6 18",
  folder:
    "M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
  music: "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
} as const;

export type IconName = keyof typeof icons;

export const FILLED: ReadonlySet<IconName> = new Set(["play", "pause", "next", "prev", "heart"]);
