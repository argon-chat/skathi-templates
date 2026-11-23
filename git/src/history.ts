import { markRaw, reactive, watch } from "vue";
import { LogReader, type Commit } from "./git/log";
import { repo } from "./git/repo";

export const history = reactive({
  reader: null as LogReader | null,
  /** Bumped when the reader has more commits. */
  count: 0,
  selected: null as string | null,
  /** Commits that were not there before the last reload, which drop in. */
  fresh: new Set<string>() as ReadonlySet<string>,
});

let revealPending = false;

/** Selects the commit HEAD points at once the history reloads, as after a commit. */
export function revealHead(on = true) {
  revealPending = on;
}

function restart() {
  const old = history.reader;
  const known = new Set(old?.commits.slice(0, 400).map((c) => c.sha) ?? []);
  const wasTop = history.selected !== null && old?.commits[0]?.sha === history.selected;
  old?.dispose();
  history.count = 0;
  if (!repo.path) {
    history.reader = null;
    history.selected = null;
    return;
  }
  let first = true;
  const reader: LogReader = markRaw(
    new LogReader(repo.path, () => {
      if (history.reader !== reader) return;
      history.count = reader.commits.length;
      if (!reader.commits.length && !reader.done) return;
      if (first) {
        const fresh = new Set<string>();
        if (known.size) {
          for (const c of reader.commits.slice(0, 50)) {
            if (known.has(c.sha)) break;
            fresh.add(c.sha);
          }
        }
        history.fresh = fresh;
        const lost = history.selected !== null && !reader.commits.some((c) => c.sha === history.selected);
        if (revealPending || wasTop || lost) {
          history.selected = reader.commits.find((c) => c.refs.some((r) => r.kind === "head"))?.sha ?? null;
        }
        revealPending = false;
      }
      first = false;
    }),
  );
  history.reader = reader;
  void reader.ensure(200);
}

watch(() => [repo.path, repo.headVersion], restart);

export function selectedCommit(): Commit | undefined {
  const reader = history.reader;
  if (!reader || !history.selected) return undefined;
  return reader.commits.find((c) => c.sha === history.selected);
}

/** The row of the commit HEAD points at, if it is loaded. */
export function headRow(): number {
  const reader = history.reader;
  if (!reader) return -1;
  return reader.commits.findIndex((c) => c.refs.some((r) => r.kind === "head"));
}
