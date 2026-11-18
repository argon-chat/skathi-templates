import {
  decodeRecording,
  endChunk,
  eventsChunk,
  joinBytes,
  isProtectedHeader,
  setProtection,
  LayerTable,
  metaChunk,
  recordingHeader,
  snapshotChunk,
  type DrawAction,
  type DrawEvent,
  type DrawMeta,
  type DrawSnapshot,
} from "./events";
import type { JournalEdit } from "./recordingChanges";

type Bytes = Uint8Array<ArrayBuffer>;
type RecordedStroke = Extract<DrawAction, { kind: "stroke" }>;
export type RecordingState = "idle" | "recording" | "paused" | "stopped" | "error";
interface Session {
  revision: number;
  generation: number;
  documentRevision: number;
  protected: boolean;
  aliases?: [number, string][];
  chunks: number;
  count: number;
  last: number;
  elapsed: number;
  state: Exclude<RecordingState, "idle" | "error">;
}
interface Job {
  before: number;
  head: Session;
  reset: boolean;
  parts: () => Promise<Bytes[]>;
  draft?: null | (() => Promise<Bytes>);
  draftRevision?: number;
}
interface Prepared {
  job: Job;
  chunks: Bytes[];
  draft: { bytes: Bytes; revision: number } | null | undefined;
}
declare const requestIdleCallback: ((fn: () => void) => number) | undefined;
declare const cancelIdleCallback: (id: number) => void;

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
function session(v: unknown): v is Session {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<Session>;
  return (
    [s.revision, s.generation, s.documentRevision, s.chunks, s.count, s.last, s.elapsed].every(
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
class JournalConflict extends Error {}
function persist(db: IDBDatabase, batch: readonly Prepared[]) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["session", "chunks"], "readwrite");
    const sessions = tx.objectStore("session"),
      chunks = tx.objectStore("chunks");
    const current = sessions.get("current");
    let conflict = false;
    current.onsuccess = () => {
      const stored = current.result;
      if ((session(stored) ? stored.revision : 0) !== batch[0]!.job.before) {
        conflict = true;
        tx.abort();
        return;
      }
      let latestDraft: Prepared["draft"];
      for (const part of batch) {
        if (part.job.reset) chunks.clear();
        if (part.draft !== undefined) latestDraft = part.draft;
        let i = part.job.head.chunks - part.chunks.length;
        for (const chunk of part.chunks) chunks.put(chunk, i++);
      }
      if (latestDraft === null) sessions.delete("draft");
      else if (latestDraft) sessions.put(latestDraft, "draft");
      sessions.put(batch.at(-1)!.job.head, "current");
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        conflict
          ? new JournalConflict("Another window changed this recording. Retry to load the saved journal.")
          : tx.error,
      );
  });
}

export class EventRecorder {
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;
  private head: Session | null = null;
  private batch: DrawEvent[] = [];
  private base = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private idle: number | undefined;
  private jobs: Job[] = [];
  private writing: Promise<void> | null = null;
  private failure: Error | null = null;
  private conflict = false;
  private failedAt = 0;
  private committed: Session | null = null;
  private table = new LayerTable();
  private documentRevision = 0;
  private hasDraft = false;
  private draft: { bytes: Bytes; revision: number } | null = null;
  metadata: DrawMeta | null = null;
  constructor(
    private readonly onError?: (error: Error) => void,
    private readonly onCommit?: (generation: number, revision: number) => void,
  ) {}

  get state(): RecordingState {
    return this.failure ? "error" : (this.head?.state ?? "idle");
  }
  get protected(): boolean {
    return this.head?.protected ?? false;
  }
  get error(): string {
    return this.failure?.message ?? "";
  }
  get generation(): number {
    return this.head?.generation ?? 0;
  }
  get savedDocumentRevision(): number {
    return this.committed?.documentRevision ?? 0;
  }
  get elapsed(): number {
    if (!this.head) return 0;
    if (this.failure) return this.failedAt;
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
        this.failure = e instanceof Error ? e : new Error("Draw could not open the recording journal.");
        this.conflict = true;
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
    this.committed = this.head;
    this.documentRevision = this.head?.documentRevision ?? 0;
    this.table = new LayerTable(this.head?.aliases);
    if (this.head && header instanceof Uint8Array && metadata instanceof Uint8Array) {
      this.metadata = (await decodeRecording(joinBytes([header, metadata]))).meta;
    }
    if (this.head && typeof this.head.protected !== "boolean" && header instanceof Uint8Array)
      this.head.protected = isProtectedHeader(header);
    this.base = performance.now() - (this.head?.elapsed ?? 0);
    if (this.head?.state === "recording" && draft !== undefined) {
      if (!(
        typeof draft === "object" &&
        draft &&
        "bytes" in draft &&
        draft.bytes instanceof Uint8Array &&
        draft.bytes.buffer instanceof ArrayBuffer &&
        "revision" in draft &&
        typeof draft.revision === "number" &&
        Number.isSafeInteger(draft.revision)
      ))
        throw new Error("Draw could not read the interrupted stroke.");
      this.hasDraft = true;
      this.draft = {
        bytes: new Uint8Array(draft.bytes.buffer, draft.bytes.byteOffset, draft.bytes.byteLength),
        revision: draft.revision,
      };
    }
  }

  async interruptedStroke(revision: number) {
    const saved = this.draft;
    this.draft = null;
    if (!saved || this.state !== "recording") return null;
    if (saved.revision !== revision) {
      this.checkpoint(null);
      return null;
    }
    const file = await decodeRecording(
      joinBytes([recordingHeader(this.protected), metaChunk(this.metadata!), saved.bytes]),
      this.table,
    );
    const stroke = file.events[0];
    if (stroke?.kind !== "stroke") throw new Error("Draw could not restore the interrupted stroke.");
    return stroke;
  }

  async readDocument() {
    return decodeRecording(await this.bytes(), this.table);
  }

  async start(
    meta: DrawMeta,
    initial: DrawSnapshot | null,
    protectedFlag: boolean,
    documentRevision = 0,
  ): Promise<void> {
    await this.recover();
    if (this.failure) throw this.failure;
    if (this.state === "recording" || this.state === "paused")
      throw new Error("Stop the current recording before starting another.");
    const before = this.head?.revision ?? 0;
    const header = recordingHeader(protectedFlag);
    this.table = new LayerTable();
    this.documentRevision = documentRevision;
    this.metadata = meta;
    this.hasDraft = false;
    this.draft = null;
    this.base = performance.now();
    const head: Session = {
      revision: before + 1,
      generation: before + 1,
      documentRevision,
      protected: protectedFlag,
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
        if (initial) parts.push(await snapshotChunk(initial, this.table));
        return parts;
      },
    });
    await this.drain();
  }

  record(action: DrawAction, revision?: number, time = this.elapsed): void {
    if (this.state !== "recording") return;
    const at = Math.max(time, this.batch.at(-1)?.at ?? this.head?.last ?? 0);
    if (at > this.elapsed) this.base = performance.now() - at;
    if (revision !== undefined) this.documentRevision = revision;
    this.batch.push({ ...action, at });
    if (action.kind === "stroke") {
      this.seal(undefined, this.hasDraft ? null : undefined);
    } else if (this.timer === undefined) {
      this.timer = setTimeout(() => this.seal(), 1750);
    }
  }

  checkpoint(stroke: RecordedStroke | null, documentRevision = this.documentRevision): void {
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
    this.seal(
      undefined,
      () =>
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
          this.table,
        ),
      documentRevision,
    );
  }

  private seal(state?: Session["state"], draft?: Job["draft"], draftRevision?: number, force = false) {
    clearTimeout(this.timer);
    this.timer = undefined;
    const prev = this.head;
    if (this.failure || !prev || (!this.batch.length && !state && draft === undefined && !force)) return;
    if (state === "paused" || state === "stopped") draft = null;
    if (draft !== undefined) this.hasDraft = draft !== null;
    const batch = this.batch;
    this.batch = [];
    const elapsed = Math.max(this.elapsed, batch.at(-1)?.at ?? prev.last);
    const head = {
      ...prev,
      documentRevision: this.documentRevision,
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
      ...(draftRevision !== undefined ? { draftRevision } : {}),
      parts: async () => {
        const result = batch.length ? [await eventsChunk(batch, prev.last, this.table)] : [];
        if (state === "stopped") result.push(endChunk(head.elapsed, head.count));
        return result;
      },
    });
    if (!this.failure && !this.writing && this.scheduled === undefined) {
      const write = () => {
        void this.drain().catch(() => {});
      };
      // Keep each stroke's independently recoverable chunk, but share one storage transaction across quick strokes.
      this.scheduled = setTimeout(
        () => {
          if (typeof requestIdleCallback !== "function") {
            write();
            return;
          }
          this.idle = requestIdleCallback(write);
          this.scheduled = setTimeout(write, 32);
        },
        draft !== undefined ? 0 : 120,
      );
    }
  }

  private drain(): Promise<void> {
    clearTimeout(this.scheduled);
    this.scheduled = undefined;
    if (this.idle !== undefined) {
      cancelIdleCallback(this.idle);
      this.idle = undefined;
    }
    if (this.writing) return this.writing;
    if (this.failure) return Promise.reject(this.failure);
    if (!this.jobs.length) return Promise.resolve();
    const run = async () => {
      await Promise.resolve();
      try {
        while (this.jobs.length) {
          if (!this.db) throw new Error("Open the recording journal before saving.");
          const batch: Prepared[] = [];
          for (const job of this.jobs.slice(0, 16)) {
            const chunks = await job.parts();
            const draft = job.draft ? { bytes: await job.draft(), revision: job.draftRevision! } : job.draft;
            job.head.aliases = this.table.entries();
            batch.push({ job, chunks, draft });
          }
          await persist(this.db, batch);
          this.jobs.splice(0, batch.length);
          this.committed = batch.at(-1)!.job.head;
          this.onCommit?.(this.committed.generation, this.committed.documentRevision);
        }
      } catch (cause: unknown) {
        this.failedAt = this.elapsed;
        this.conflict = cause instanceof JournalConflict;
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
  async setProtected(value: boolean): Promise<void> {
    if (!this.head || this.head.protected === value) return;
    if (this.failure) throw this.failure;
    this.head = { ...this.head, protected: value };
    this.seal(undefined, undefined, undefined, true);
    await this.drain();
  }
  fail(error: unknown) {
    if (this.failure) return;
    this.failedAt = this.elapsed;
    this.failure = error instanceof Error ? error : new Error("Draw could not restore the recording.");
    this.onError?.(this.failure);
  }
  async retry(): Promise<boolean> {
    if (!this.failure) return false;
    this.failure = null;
    if (this.conflict) {
      this.db?.close();
      this.db = null;
      this.head = null;
      this.batch = [];
      this.jobs = [];
      this.draft = null;
      this.hasDraft = false;
      this.conflict = false;
      await this.recover();
      return true;
    }
    this.base = performance.now() - this.failedAt;
    await this.drain();
    return false;
  }
  async pause(): Promise<void> {
    if (this.state === "recording") this.seal("paused");
    await this.drain();
  }
  async resume(edits: readonly JournalEdit[] = []): Promise<void> {
    if (this.state === "paused") {
      const at = this.elapsed;
      for (const edit of edits) {
        this.batch.push({ ...edit.action, at });
        this.documentRevision = edit.revision;
      }
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
    this.seal();
    await this.drain();
    const revision = this.committed?.revision;
    const tx = this.db.transaction(["session", "chunks"]);
    const [stored, parts] = await Promise.all([
      request(tx.objectStore("session").get("current")),
      request(tx.objectStore("chunks").getAll()),
    ]);
    if (session(stored) && stored.revision !== revision) {
      const conflict = new JournalConflict("Another window changed this recording. Retry to load the saved journal.");
      this.conflict = true;
      this.fail(conflict);
      throw conflict;
    }
    if (
      !session(stored) ||
      stored.chunks !== parts.length ||
      !parts.every((p): p is Uint8Array => p instanceof Uint8Array)
    ) {
      throw new Error("Draw could not read all saved recording chunks.");
    }
    if (stored.state !== "stopped") parts.push(endChunk(Math.max(stored.elapsed, this.elapsed), stored.count));
    const out = joinBytes(parts);
    setProtection(out, protectedOverride ?? stored.protected);
    return out;
  }
}
