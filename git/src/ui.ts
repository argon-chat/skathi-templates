import { nextTick, reactive } from "vue";
import { reducedMotion } from "./theme";

export interface Selection {
  path: string;
  staged: boolean;
}

export interface Confirm {
  title: string;
  body: string;
  action: string;
  resolve: (yes: boolean) => void;
}

export const ui = reactive({
  tab: "changes" as "changes" | "history",
  selected: null as Selection | null,
  confirm: null as Confirm | null,
  menu: null as "branch" | "repo" | null,
  draft: "",
  amend: false,
  commitError: null as string | null,
  /** Diffs wrap long lines instead of scrolling sideways. */
  wrap: false,
  /** The file row that moves between the lists in a view transition. */
  moving: null as Selection | null,
});

/** Runs a state change inside a view transition, so the snapshot of the old and new DOM animates. */
export async function transition(change: () => void | Promise<unknown>): Promise<void> {
  if (reducedMotion.value || document.hidden) {
    await change();
    return;
  }
  const t = document.startViewTransition(async () => {
    await change();
    await nextTick();
  });
  await t.finished.catch(() => {});
}

export function setTab(tab: "changes" | "history") {
  if (ui.tab !== tab)
    void transition(() => {
      ui.tab = tab;
    });
}

export function ask(title: string, body: string, action: string): Promise<boolean> {
  ui.confirm?.resolve(false);
  return new Promise((resolve) => {
    ui.confirm = {
      title,
      body,
      action,
      resolve: (yes) => {
        ui.confirm = null;
        resolve(yes);
      },
    };
  });
}

export function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) };
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2629800, "month"],
    [31557600, "year"],
  ];
  let unit = units[0]!;
  for (const u of units) if (s >= u[0] * 0.9) unit = u;
  const n = Math.max(1, Math.round(s / unit[0]));
  return `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

export function fullDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
