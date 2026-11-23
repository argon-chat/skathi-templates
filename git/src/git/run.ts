import { Process } from "skathi:process";

const ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_EDITOR: "true",
  GIT_PAGER: "cat",
  LC_ALL: "C",
};

const BASE = [
  "-c",
  "color.ui=never",
  "-c",
  "core.quotepath=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
];

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout = "",
  ) {
    super(stderr.trim() || stdout.trim() || `git ${args[0] ?? ""} exited with code ${code}`);
    this.name = "GitError";
  }
}

export interface RunOptions {
  signal?: AbortSignal | undefined;
  /** Bytes of stdout kept; past it the process is killed and `truncated` is set. */
  cap?: number;
  input?: string;
  /** Exit codes that are not failures (`git diff --no-index` exits 1 when files differ). */
  ok?: readonly number[];
  /** Locks the index, so an optional lock is wanted. */
  write?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  truncated: boolean;
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function drain(stream: ReadableStream<Uint8Array>, cap: number, onCap: () => void) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    if (truncated) continue;
    if (size + value.length > cap) {
      chunks.push(value.subarray(0, cap - size));
      size = cap;
      truncated = true;
      onCap();
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { text: new TextDecoder().decode(out), truncated };
}

const LOCKED = /index\.lock'?: File exists/;

/** Runs git in `cwd`. Rejects with a `GitError` on a failing exit code and an `AbortError` when `signal` aborts. */
export async function git(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  // An editor or another tool refreshing the index holds its lock for a moment; git fails before doing anything then.
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(cwd, args, options);
    } catch (e) {
      if (!options.write || attempt >= 5 || !(e instanceof GitError) || !LOCKED.test(e.stderr)) throw e;
      await new Promise<void>((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
}

async function once(cwd: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  options.signal?.throwIfAborted();
  const env = options.write ? { ...ENV, GIT_OPTIONAL_LOCKS: "1" } : ENV;
  const child = Process.spawn("git", [...BASE, ...args], {
    cwd,
    env,
    stdin: options.input === undefined ? "ignore" : "pipe",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (options.input !== undefined && child.stdin) {
    const writer = child.stdin.getWriter();
    void writer
      .write(new TextEncoder().encode(options.input))
      .then(() => writer.close())
      .catch(() => {});
  }
  const kill = () => child.kill();
  const [out, err, code] = await Promise.all([
    drain(child.stdout!, options.cap ?? 64 * 1024 * 1024, kill),
    drain(child.stderr!, 256 * 1024, () => {}),
    child.exited,
  ]);
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  if (out.truncated) return { stdout: out.text, stderr: err.text, code, truncated: true };
  if (code !== 0 && !(code !== null && options.ok?.includes(code))) {
    throw new GitError(args, code, err.text, out.text);
  }
  return { stdout: out.text, stderr: err.text, code, truncated: false };
}

/** Streams git's stdout as text chunks; the caller stops reading to pause git (the pipe fills) or aborts to end it. */
export function gitStream(cwd: string, args: readonly string[], signal: AbortSignal) {
  const child = Process.spawn("git", [...BASE, ...args], { cwd, env: ENV, stdin: "ignore", stderr: "pipe", signal });
  let stderr = "";
  void (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of child.stderr!) stderr += decoder.decode(chunk, { stream: true });
    } catch {}
  })();
  return { child, stderr: () => stderr };
}
