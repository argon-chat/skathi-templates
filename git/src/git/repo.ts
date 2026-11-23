import { reactive, shallowRef } from "vue";
import { git, GitError, isAbort, type RunOptions } from "./run";
import { parseStatus, type FileChange, type Status } from "./status";

export interface BranchInfo {
  name: string;
  upstream: string;
  track: string;
  time: number;
  /** The subject of the commit the branch points at. */
  subject: string;
}

export interface Notice {
  id: number;
  kind: "error" | "ok" | "info";
  title: string;
  detail: string;
}

const RECENT_KEY = "git-template.recent";

function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export const repo = reactive({
  path: null as string | null,
  opening: false,
  /** Why the folder that was asked for cannot be shown. */
  openError: null as { path: string; message: string } | null,
  status: null as Status | null,
  statusError: null as string | null,
  /** Bumped when HEAD moves, so history reloads. */
  headVersion: 0,
  /** What a write is doing, for the busy state of its button. */
  busy: null as string | null,
  network: null as "fetch" | "pull" | "push" | null,
  /** When a fetch or pull last finished in this session. */
  fetchedAt: null as number | null,
  recent: loadRecent(),
  notices: [] as Notice[],
});

export const branches = shallowRef<BranchInfo[]>([]);

let noticeId = 0;
export function notify(kind: Notice["kind"], title: string, detail = "") {
  const notice = { id: ++noticeId, kind, title, detail: detail.trim() };
  repo.notices = [...repo.notices.slice(-3), notice];
  if (kind !== "error") setTimeout(() => dismiss(notice.id), 4500);
}

export function dismiss(id: number) {
  repo.notices = repo.notices.filter((n) => n.id !== id);
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function repoName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
  );
}

function remember(path: string) {
  repo.recent = [path, ...repo.recent.filter((p) => p !== path)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(repo.recent));
  } catch {}
}

export function forget(path: string) {
  repo.recent = repo.recent.filter((p) => p !== path);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(repo.recent));
  } catch {}
}

export function read(args: readonly string[], options: RunOptions = {}) {
  if (!repo.path) return Promise.reject(new Error("No repository is open."));
  return git(repo.path, args, options);
}

let writing: Promise<unknown> = Promise.resolve();

/** Runs writes one at a time, then refreshes. A failure is a notice with git's own stderr. */
export async function write<T>(
  label: string,
  run: () => Promise<T>,
  failure: string | ((error: unknown) => void) = "Git failed",
): Promise<T | undefined> {
  const previous = writing;
  let release!: () => void;
  writing = new Promise<void>((r) => (release = r));
  await previous;
  repo.busy = label;
  try {
    return await run();
  } catch (e) {
    if (isAbort(e)) return undefined;
    if (typeof failure === "function") failure(e);
    else notify("error", failure, errorText(e));
    return undefined;
  } finally {
    repo.busy = null;
    release();
    void refresh();
  }
}

export async function open(path: string) {
  repo.opening = true;
  repo.openError = null;
  try {
    const { stdout } = await git(path, ["rev-parse", "--show-toplevel"], { signal: AbortSignal.timeout(10_000) });
    const top = stdout.trim().replace(/\//g, path.includes("\\") ? "\\" : "/");
    statusAbort?.abort();
    repo.path = top;
    repo.status = null;
    repo.statusError = null;
    branches.value = [];
    remember(top);
    repo.headVersion++;
    await refresh();
  } catch (e) {
    let message = errorText(e);
    if (e instanceof GitError && /not a git repository/i.test(e.stderr))
      message = "This folder is not a git repository.";
    else if (e instanceof Error && e.name === "NotFoundError") message = "The folder does not exist.";
    else if (e instanceof Error && e.name === "NotAllowedError") message = `git could not be started: ${message}`;
    repo.openError = { path, message };
  } finally {
    repo.opening = false;
  }
}

export function close() {
  statusAbort?.abort();
  repo.path = null;
  repo.status = null;
  branches.value = [];
}

let statusAbort: AbortController | null = null;
let lastHead: string | null | undefined;

export async function refresh() {
  if (!repo.path) return;
  statusAbort?.abort();
  const abort = new AbortController();
  statusAbort = abort;
  try {
    const [status, refs] = await Promise.all([
      read(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--find-renames"], {
        signal: abort.signal,
      }),
      read(
        [
          "for-each-ref",
          "--sort=-committerdate",
          "--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(contents:subject)",
          "refs/heads",
        ],
        { signal: abort.signal },
      ),
    ]);
    repo.status = parseStatus(status.stdout);
    repo.statusError = null;
    branches.value = refs.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", upstream = "", track = "", time = "0", subject = ""] = line.split("\0");
        return { name, upstream, track, time: Number(time) * 1000, subject };
      });
    const head = `${repo.status.branch.head ?? ""}@${repo.status.branch.oid ?? ""}`;
    if (lastHead !== undefined && lastHead !== head) repo.headVersion++;
    lastHead = head;
  } catch (e) {
    if (!isAbort(e)) repo.statusError = errorText(e);
  }
}

const unborn = () => repo.status?.branch.oid === null;

export function stage(files: FileChange[]) {
  if (!files.length) return;
  return write(
    "stage",
    () => read(["add", "-A", "--", ...files.map((f) => f.path)], { write: true }),
    "Could not stage",
  );
}

export function unstage(files: FileChange[]) {
  if (!files.length) return;
  const paths = files.flatMap((f) => (f.from ? [f.from, f.path] : [f.path]));
  return write(
    "unstage",
    () =>
      unborn()
        ? read(["rm", "--cached", "-r", "-q", "--", ...paths], { write: true })
        : read(["restore", "--staged", "--", ...paths], { write: true }),
    "Could not unstage",
  );
}

export function discard(files: FileChange[]) {
  const untracked = files.filter((f) => f.kind === "untracked").map((f) => f.path);
  const tracked = files.filter((f) => f.kind !== "untracked").map((f) => f.path);
  return write(
    "discard",
    async () => {
      if (tracked.length) await read(["restore", "--worktree", "--", ...tracked], { write: true });
      if (untracked.length) await read(["clean", "-f", "-q", "--", ...untracked], { write: true });
    },
    "Could not discard",
  );
}

/** `git apply` of a patch made by `selection()`: to the index, or (already reversed) to the index or the work tree. */
export function apply(patch: string, mode: "stage" | "unstage" | "discard") {
  const args = ["apply", "--whitespace=nowarn"];
  if (mode !== "discard") args.push("--cached");
  args.push("-");
  const failure = { stage: "Could not stage", unstage: "Could not unstage", discard: "Could not discard" }[mode];
  return write(mode, () => read(args, { input: patch, write: true }), failure);
}

export async function lastMessage(): Promise<string> {
  try {
    return (await read(["log", "-1", "--format=%B"])).stdout.replace(/\s+$/, "");
  } catch {
    return "";
  }
}

export function commit(message: string, amend: boolean, onError: (error: unknown) => void) {
  const args = ["commit", "--file=-", "--cleanup=strip"];
  if (amend) args.push("--amend");
  return write(
    "commit",
    async () => {
      const result = await read(args, { input: message, write: true });
      repo.headVersion++;
      return result;
    },
    onError,
  );
}

export function switchTo(name: string, create = false) {
  return write(
    create ? "create" : "switch",
    async () => {
      await read(create ? ["switch", "-c", name] : ["switch", name], { write: true });
      repo.headVersion++;
      notify("ok", create ? `Created and switched to ${name}` : `Switched to ${name}`);
      return true;
    },
    create ? `Could not create ${name}` : `Could not switch to ${name}`,
  );
}

let networkAbort: AbortController | null = null;

export function cancelNetwork() {
  networkAbort?.abort();
}

async function upstreamPush(): Promise<string[]> {
  const branch = repo.status?.branch;
  if (!branch?.head || branch.upstream) return ["push"];
  const remotes = (await read(["remote"])).stdout.split("\n").filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  return remote ? ["push", "--set-upstream", remote, branch.head] : ["push"];
}

export async function network(kind: "fetch" | "pull" | "push") {
  if (repo.network) return;
  repo.network = kind;
  networkAbort = new AbortController();
  const signal = networkAbort.signal;
  const title = { fetch: "Fetch", pull: "Pull", push: "Push" }[kind];
  try {
    const args =
      kind === "fetch" ? ["fetch", "--prune"] : kind === "pull" ? ["pull", "--no-edit"] : await upstreamPush();
    const result = await write(
      kind,
      async () => {
        const r = await read(args, { signal, write: true });
        repo.headVersion++;
        return r;
      },
      `${title} failed`,
    );
    if (result && kind !== "push") repo.fetchedAt = Date.now();
    if (result) notify("ok", `${title} finished`, `${result.stdout}\n${result.stderr}`.trim() || "Already up to date.");
  } finally {
    if (signal.aborted) notify("info", `${title} cancelled`);
    repo.network = null;
    networkAbort = null;
  }
}
