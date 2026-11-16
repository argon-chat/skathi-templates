import { player } from "./player.svelte";
import type { Track } from "./tracks";

export type View = "all" | "liked" | "files";

export const VIEWS: readonly { id: View; label: string; icon: "music" | "heart" | "folder" }[] = [
  { id: "all", label: "All songs", icon: "music" },
  { id: "liked", label: "Liked songs", icon: "heart" },
  { id: "files", label: "Your files", icon: "folder" },
];

export const library = $state<{ view: View; recent: string[] }>({ view: "all", recent: [] });

export function inView(track: Track, view: View) {
  if (view === "liked") return player.liked.has(track.id);
  if (view === "files") return typeof track.source !== "string";
  return true;
}

export function played(id: string) {
  library.recent = [id, ...library.recent.filter((r) => r !== id)].slice(0, 5);
}
