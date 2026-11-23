import { Graph } from "./graph";
import { git, gitStream } from "./run";

export interface Ref {
  name: string;
  kind: "head" | "branch" | "remote" | "tag";
}

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  refs: Ref[];
  subject: string;
  /** The first line of the body, if any. */
  body: string;
}

const REVS = ["--branches", "--remotes", "--tags", "HEAD"];
const FORMAT = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b%x1e";

function parseRefs(decoration: string): Ref[] {
  if (!decoration) return [];
  const refs: Ref[] = [];
  for (const part of decoration.split(", ")) {
    if (part.startsWith("HEAD -> ")) refs.push({ name: part.slice(8).replace(/^refs\/heads\//, ""), kind: "head" });
    else if (part === "HEAD") refs.push({ name: "HEAD", kind: "head" });
    else if (part.startsWith("tag: ")) refs.push({ name: part.slice(5).replace(/^refs\/tags\//, ""), kind: "tag" });
    else if (part.startsWith("refs/heads/")) refs.push({ name: part.slice(11), kind: "branch" });
    else if (part.startsWith("refs/remotes/")) {
      if (!part.endsWith("/HEAD")) refs.push({ name: part.slice(13), kind: "remote" });
    } else if (part.startsWith("refs/tags/")) refs.push({ name: part.slice(10), kind: "tag" });
  }
  return refs;
}

function parseCommit(record: string): Commit | null {
  const f = record.split("\x1f");
  if (f.length < 8) return null;
  const body = (f[7] ?? "").split("\n").find((l) => l.trim()) ?? "";
  return {
    sha: f[0]!,
    parents: f[1] ? f[1].split(" ") : [],
    author: f[2]!,
    email: f[3]!,
    time: Number(f[4]) * 1000,
    refs: parseRefs(f[5]!),
    subject: f[6]!,
    body: body.trim().slice(0, 200),
  };
}

/**
 * Every branch's history, newest first, read as the list needs it: git writes into a pipe that fills
 * when nothing reads, so a 100k-commit log costs only the pages that were shown. The graph's lanes are
 * laid out as each page arrives.
 */
export class LogReader {
  readonly commits: Commit[] = [];
  readonly graph = new Graph();
  done = false;
  error: string | null = null;
  /** From `git rev-list --count`, so the list can be its full height before the commits are read. */
  total: number | null = null;
  private readonly abort = new AbortController();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly decoder = new TextDecoder();
  private rest = "";
  private pulling: Promise<void> | null = null;
  private stderr: () => string = () => "";

  constructor(
    private readonly cwd: string,
    private readonly onChange: () => void,
  ) {
    void git(cwd, ["rev-list", "--count", ...REVS, "--"], { signal: this.abort.signal })
      .then(({ stdout }) => {
        const n = Number(stdout.trim());
        if (Number.isFinite(n) && !this.done) {
          this.total = n;
          this.onChange();
        }
      })
      .catch(() => {});
  }

  /** Reads until at least `count` commits are known or the log ends. */
  ensure(count: number): Promise<void> {
    if (this.done || this.commits.length >= count) return Promise.resolve();
    this.pulling ??= this.pull(count).finally(() => {
      this.pulling = null;
    });
    return this.pulling.then(() => this.ensure(count));
  }

  private async pull(count: number) {
    if (!this.reader) {
      const { child, stderr } = gitStream(
        this.cwd,
        ["log", FORMAT, "--date-order", "--decorate=full", "--no-show-signature", ...REVS, "--"],
        this.abort.signal,
      );
      this.stderr = stderr;
      this.reader = child.stdout!.getReader();
    }
    try {
      let reads = 0;
      while (this.commits.length < count) {
        const { done, value } = await this.reader.read();
        if (done) {
          this.finish();
          break;
        }
        const text = this.rest + this.decoder.decode(value, { stream: true });
        const records = text.split("\x1e");
        this.rest = records.pop() ?? "";
        for (const r of records) {
          const commit = parseCommit(r.replace(/^\n/, ""));
          if (commit) this.commits.push(commit);
        }
        this.graph.extend(this.commits);
        if (++reads % 16 === 0) this.onChange();
      }
    } catch (e) {
      if (!this.abort.signal.aborted) this.error = e instanceof Error ? e.message : String(e);
      this.done = true;
    }
    this.onChange();
  }

  private finish() {
    this.done = true;
    this.total = this.commits.length;
    if (!this.commits.length) {
      const err = this.stderr().trim();
      if (err && !/does not have any commits|unknown revision|bad default revision|ambiguous argument/.test(err))
        this.error = err;
    }
  }

  dispose() {
    this.abort.abort();
  }
}
