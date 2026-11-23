import { computed, shallowRef, watch } from "vue";
import { read, repo } from "./git/repo";
import { isAbort } from "./git/run";
import { history } from "./history";

const WEEKS = 12;
const WEEK = 7 * 86400_000;

/** Commits per week on HEAD over the last twelve weeks, oldest first. */
export const activity = shallowRef<number[]>([]);

let abort: AbortController | null = null;

watch(
  () => [repo.path, repo.headVersion],
  async () => {
    abort?.abort();
    activity.value = [];
    if (!repo.path) return;
    const controller = new AbortController();
    abort = controller;
    try {
      const { stdout } = await read(["log", `--since=${WEEKS}.weeks`, "--format=%at", "HEAD", "--"], {
        signal: controller.signal,
        ok: [128],
      });
      const now = Date.now();
      const weeks = new Array<number>(WEEKS).fill(0);
      for (const line of stdout.split("\n")) {
        if (!line) continue;
        const age = Math.floor((now - Number(line) * 1000) / WEEK);
        if (age >= 0 && age < WEEKS) weeks[WEEKS - 1 - age]!++;
      }
      if (abort === controller) activity.value = weeks;
    } catch (e) {
      if (!isAbort(e) && abort === controller) activity.value = [];
    }
  },
  { immediate: true },
);

/** The lane colour index of the commit HEAD points at, once the history has laid it out. */
export const headColor = computed(() => {
  void history.count;
  const reader = history.reader;
  if (!reader) return 0;
  const at = reader.commits.findIndex((c) => c.refs.some((r) => r.kind === "head"));
  return at < 0 ? 0 : (reader.graph.rows[at]?.color ?? 0);
});
