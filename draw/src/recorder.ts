import {
  decodeRecording,
  endChunk,
  eventsChunk,
  joinBytes,
  metaChunk,
  recordingHeader,
  snapshotChunk,
  type DrawAction,
  type DrawEvent,
  type DrawMeta,
  type DrawSnapshot,
} from "./events";

type Bytes = Uint8Array<ArrayBuffer>;
type RecordedStroke = Extract<DrawAction, { kind: "stroke" }>;
export type RecordingState = "idle" | "recording" | "paused" | "stopped";
interface Session {
  revision: number;
  chunks: number;
  count: number;
  last: number;
  elapsed: number;
  state: Exclude<RecordingState, "idle">;
}
interface Job {
  before: number;
  head: Session;
  reset: boolean;
  parts: () => Promise<Bytes[]>;
  draft?: null | (() => Promise<Bytes>);
}

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
function session(v: unknown): v is Session {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<Session>;
  return (
    [s.revision, s.chunks, s.count, s.last, s.elapsed].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
    ) &&
    (s.state === "recording" || s.state === "paused" || s.state === "stopped")
  );
}
async function openJournal() {
  const db = indexedDB.open("skathi-draw-events", 1);
  db.onupgradeneeded = () => {
    db.result.createObjectStore("chunks");
    db.result.createObjectStore("session");
  };
  return request(db);
}
function persist(db: IDBDatabase, job: Job, parts: Bytes[], draft: Bytes | null | undefined) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["session", "chunks"], "readwrite");
    const sessions = tx.objectStore("session"),
      chunks = tx.objectStore("chunks");
    const current = sessions.get("current");
    let conflict = false;
    current.onsuccess = () => {
      const stored = current.result;
      if ((session(stored) ? stored.revision : 0) !== job.before) {
        conflict = true;
        tx.abort();
        return;
      }
      if (job.reset) chunks.clear();
      if (draft === null) sessions.delete("draft");
      else if (draft) sessions.put(draft, "draft");
      let i = job.head.chunks - parts.length;
      for (const part of parts) chunks.put(part, i++);
      sessions.put(job.head, "current");
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(conflict ? new Error("The recording changed in another window. Reopen Draw to load it.") : tx.error);
  });
}

export class EventRecorder {
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;
  private head: Session | null = null;
  private batch: DrawEvent[] = [];
  private base = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private jobs: Job[] = [];
  private writing: Promise<void> | null = null;
  private failure: Error | null = null;
  private protectedFlag = false;
  private hasDraft = false;
  recoveredStroke: RecordedStroke | null = null;
  constructor(private readonly onError?: (error: Error) => void) {}

  get state(): RecordingState {
    return this.head?.state ?? "idle";
  }
  get protected(): boolean {
    return this.protectedFlag;
  }
  get elapsed(): number {
    if (!this.head) return 0;
    return this.head.state === "recording"
      ? Math.max(this.head.elapsed, Math.round(performance.now() - this.base))
      : this.head.elapsed;
  }

  recover(): Promise<void> {
    if (this.opening) return this.opening;
    if (this.db) return Promise.resolve();
    this.opening = this.restore()
      .catch((e: unknown) => {
        this.db?.close();
        this.db = null;
        this.head = null;
        this.jobs = [];
        throw e;
      })
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  private async restore() {
    this.db = await openJournal();
    const tx = this.db.transaction(["session", "chunks"]);
    const [current, header, metadata, draft] = await Promise.all([
      request(tx.objectStore("session").get("current")),
      request(tx.objectStore("chunks").get(0)),
      request(tx.objectStore("chunks").get(1)),
      request(tx.objectStore("session").get("draft")),
    ]);
    if (current !== undefined && !session(current)) throw new Error("Draw could not read the saved recording journal.");
    this.head = current ?? null;
    this.protectedFlag = header instanceof Uint8Array && (header[8]! & 1) !== 0;
    this.base = performance.now() - (this.head?.elapsed ?? 0);
    if (this.head?.state === "recording" && draft !== undefined) {
      if (!(header instanceof Uint8Array && metadata instanceof Uint8Array && draft instanceof Uint8Array))
        throw new Error("Draw could not read the interrupted stroke.");
      const restored = await decodeRecording(joinBytes([header, metadata, draft]));
      const stroke = restored.events[0];
      if (stroke?.kind !== "stroke") throw new Error("Draw could not restore the interrupted stroke.");
      this.recoveredStroke = { kind: "stroke", layer: stroke.layer, strokes: stroke.strokes };
      this.hasDraft = true;
      this.batch.push({ ...this.recoveredStroke, at: Math.max(this.head.last, stroke.at) });
      this.seal(undefined, null);
      await this.drain();
    }
  }

  async start(meta: DrawMeta, initial: DrawSnapshot | null, protectedFlag: boolean): Promise<void> {
    await this.recover();
    if (this.state === "recording" || this.state === "paused")
      throw new Error("Stop the current recording before starting another.");
    const before = this.head?.revision ?? 0;
    const header = recordingHeader(protectedFlag);
    this.protectedFlag = protectedFlag;
    this.hasDraft = false;
    this.recoveredStroke = null;
    this.base = performance.now();
    const head: Session = {
      revision: before + 1,
      chunks: initial ? 3 : 2,
      count: 0,
      last: 0,
      elapsed: 0,
      state: "recording",
    };
    this.head = head;
    this.jobs.push({
      before,
      head,
      reset: true,
      draft: null,
      parts: async () => {
        const parts = [header, metaChunk(meta)];
        if (initial) parts.push(await snapshotChunk(initial));
        return parts;
      },
    });
    await this.drain();
  }

  record(action: DrawAction): void {
    if (this.state !== "recording") return;
    const at = this.elapsed;
    this.batch.push({ ...action, at });
    if (action.kind === "stroke") {
      this.seal(undefined, this.hasDraft ? null : undefined);
    } else if (this.timer === undefined) {
      this.timer = setTimeout(() => this.seal(), 2000);
    }
  }

  checkpoint(stroke: RecordedStroke | null): void {
    if (this.state !== "recording") return;
    if (!stroke) {
      if (this.hasDraft) this.seal(undefined, null);
      return;
    }
    // Live strokes append points until pen-up. Freeze the prefix length without copying on the input frame.
    const at = this.elapsed;
    const prefixes = stroke.strokes
      .filter((s) => s.points.length)
      .map((s) => ({ stroke: { ...s }, length: s.points.length }));
    if (!prefixes.length) return;
    this.seal(undefined, () =>
      eventsChunk(
        [
          {
            kind: "stroke",
            layer: stroke.layer,
            at,
            strokes: prefixes.map(({ stroke: s, length }) => ({ ...s, points: s.points.slice(0, length) })),
          },
        ],
        0,
      ),
    );
  }

  private seal(state?: Session["state"], draft?: Job["draft"]) {
    clearTimeout(this.timer);
    this.timer = undefined;
    const prev = this.head;
    if (!prev || (!this.batch.length && !state && draft === undefined)) return;
    if (state === "paused" || state === "stopped") draft = null;
    if (draft !== undefined) this.hasDraft = draft !== null;
    const batch = this.batch;
    this.batch = [];
    const elapsed = this.elapsed;
    const head = {
      revision: prev.revision + 1,
      chunks: prev.chunks + Number(batch.length > 0) + Number(state === "stopped"),
      count: prev.count + batch.length,
      last: batch.at(-1)?.at ?? prev.last,
      elapsed,
      state: state ?? prev.state,
    };
    this.head = head;
    this.jobs.push({
      before: prev.revision,
      head,
      reset: false,
      ...(draft !== undefined ? { draft } : {}),
      parts: async () => {
        const result = batch.length ? [await eventsChunk(batch, prev.last)] : [];
        if (state === "stopped") result.push(endChunk(head.elapsed, head.count));
        return result;
      },
    });
    if (!this.failure) void this.drain().catch(() => {});
  }

  private drain(): Promise<void> {
    if (this.writing) return this.writing;
    if (!this.jobs.length) return Promise.resolve();
    this.failure = null;
    const run = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      try {
        while (this.jobs.length) {
          const job = this.jobs[0]!;
          if (!this.db) throw new Error("Open the recording journal before saving.");
          const parts = await job.parts();
          const draft = job.draft ? await job.draft() : job.draft;
          await persist(this.db, job, parts, draft);
          this.jobs.shift();
        }
      } catch (cause: unknown) {
        this.failure =
          cause instanceof Error
            ? cause
            : new Error("Draw could not save the recording. Check the available storage and try saving again.");
        this.onError?.(this.failure);
        throw this.failure;
      } finally {
        this.writing = null;
      }
    };
    this.writing = run();
    return this.writing;
  }

  async flush(): Promise<void> {
    this.seal(this.state === "recording" ? "recording" : undefined);
    await this.drain();
  }
  async pause(): Promise<void> {
    if (this.state === "recording") this.seal("paused");
    await this.drain();
  }
  async resume(): Promise<void> {
    if (this.state === "paused") {
      this.base = performance.now() - this.elapsed;
      this.seal("recording");
    }
    await this.drain();
  }
  async stop(): Promise<void> {
    if (this.state === "recording" || this.state === "paused") this.seal("stopped");
    await this.drain();
  }
  async bytes(protectedOverride?: boolean): Promise<Bytes> {
    if (!this.db || !this.head) throw new Error("Start a recording before saving.");
    await this.flush();
    const tx = this.db.transaction(["session", "chunks"]);
    const [stored, parts] = await Promise.all([
      request(tx.objectStore("session").get("current")),
      request(tx.objectStore("chunks").getAll()),
    ]);
    if (
      !session(stored) ||
      stored.chunks !== parts.length ||
      !parts.every((p): p is Uint8Array => p instanceof Uint8Array)
    ) {
      throw new Error("Draw could not read all saved recording chunks.");
    }
    if (stored.state !== "stopped") parts.push(endChunk(stored.elapsed, stored.count));
    const out = joinBytes(parts);
    if (protectedOverride !== undefined) out[8] = (out[8]! & ~1) | Number(protectedOverride);
    return out;
  }
}
