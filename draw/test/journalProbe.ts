import { createApp, h, watch } from "vue";
import { EventRecorder } from "../src/recorder";
import { PlaybackTimeline } from "../src/playbackTimeline";
import type { DrawAction, DrawMeta } from "../src/events";
import { transformStroke, translate } from "../src/geometry";
import type { Layer, Stroke } from "../src/model";
import { useSketchbook } from "../src/sketchbook";

const meta: DrawMeta = {
  width: 640,
  height: 480,
  view: { x: 320, y: 240, zoom: 1, angle: 0 },
  dark: false,
  paper: "plain",
  seed: 42,
};
const line = (seq: number): Stroke => ({
  seq,
  seed: seq,
  tool: "pen",
  width: 3,
  color: "ink",
  opacity: 1,
  points: [0, 0, 1, 0, 0, 0, 0, 10, 5, 1, 0, 0, 0, 20],
});

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}
async function journal() {
  const author = new EventRecorder();
  await author.start(meta, null, false);
  author.record({ kind: "stroke", layer: "layer-1", strokes: [line(1)] }, 1);
  author.checkpoint({ kind: "stroke", layer: "layer-1", strokes: [line(2)] }, 1);
  await author.setProtected(true);
  const resumed = new EventRecorder();
  await resumed.recover();
  assert(resumed.protected && resumed.savedDocumentRevision === 1, "Lost protection or document revision.");
  const draft = await resumed.interruptedStroke(1);
  assert(draft?.strokes[0]?.seq === 2, "Lost a sealed stroke checkpoint.");
  const advanced = new EventRecorder();
  await advanced.recover();
  assert((await advanced.interruptedStroke(2)) === null, "An obsolete draft overwrote the document.");
  await advanced.flush();
  author.record({ kind: "clear" }, 2);
  let conflicts = 0;
  try {
    await author.flush();
  } catch {
    conflicts++;
  }
  assert(conflicts === 1 && author.state === "error", "A stale writer silently continued recording.");
  author.record({ kind: "clear" }, 3);
  await author.retry();
  assert(
    author.state === "recording" && author.savedDocumentRevision === 1,
    "Could not retry after a revision conflict.",
  );
  const saved = await author.readDocument();
  assert(saved.protected && saved.events.length === 1, "A failed writer changed the saved recording.");
  await author.stop();
}

function normalized(layers: readonly Layer[]) {
  return layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    blend: l.blendMode ?? "normal",
    lock: l.alphaLocked ?? false,
    clip: l.clipping ?? false,
    strokes: l.strokes.map((s) => [
      s.seq,
      s.tool,
      s.color,
      s.width,
      s.opacity ?? 1,
      s.seed ?? s.seq,
      s.scope ?? [],
      s.points,
    ]),
  }));
}

async function commands(book: ReturnType<typeof useSketchbook>) {
  const recorder = new EventRecorder(undefined, (g, r) => book.acknowledge(g, r));
  await recorder.start(meta, null, false, book.revision());
  const known = new WeakSet<object>();
  book.onCommand((cmd, direction, mutation) => {
    let action: DrawAction =
      direction === "do" ? mutation() : { kind: direction, ...(!known.has(cmd) && { fallback: mutation() }) };
    if (direction === "do") known.add(cmd);
    if (recorder.state === "paused" && action.kind === "stroke")
      action = { kind: "edit", layer: action.layer, added: action.strokes, removed: [] };
    const row = { generation: recorder.generation, revision: book.revision(), at: recorder.elapsed, action };
    book.enqueue(row);
    recorder.record(action, row.revision, row.at);
  });
  const check = async (step: string) => {
    const file = await recorder.readDocument();
    const final = new PlaybackTimeline(file).final;
    assert(
      JSON.stringify(normalized(final.layers)) === JSON.stringify(normalized(book.layers.value)),
      "Document mismatch after " + step,
    );
    assert(final.active === book.active.value, "Active layer mismatch after " + step);
  };
  const a = line(book.nextSeq());
  book.addStrokes([a]);
  const moved = transformStroke(a, translate(3.125, -9.25));
  book.edit("layer-1", [a], [moved]);
  await check("transform");
  const pasted = transformStroke(moved, translate(22, 14), book.nextSeq());
  book.edit("layer-1", [], [pasted]);
  book.addLayer();
  book.addStrokes([line(book.nextSeq())]);
  book.duplicateLayer(book.active.value);
  await check("paste and duplicate");
  book.moveLayer(book.active.value, 1);
  await check("move");
  book.deleteLayer(book.active.value);
  await check("delete");
  book.undo();
  await check("restore layer");
  book.redo();
  book.setOpacity("layer-1", 1, 0.5);
  book.addStrokes([{ ...line(book.nextSeq()), tool: "eraser" }], "layer-2");
  book.toggleLayer("layer-2");
  const before = book.layers.value.flatMap((l) => l.strokes);
  book.mergeDown("layer-2");
  await check("merge");
  const merged = book.layers.value[0]!;
  assert(
    merged.visible && merged.opacity === 1 && merged.strokes.length === before.length,
    "Merging a hidden layer lost its contents.",
  );
  assert(
    merged.strokes.every((s) => !s.patch) && merged.strokes.find((s) => s.tool === "eraser")?.scope?.length,
    "The merged upper eraser escaped its vector group.",
  );
  assert(merged.strokes[0]!.opacity === 32768 / 65535, "Lower opacity was not transferred to vector ink.");
  book.undo();
  await check("unmerge");
  book.redo();
  book.clear();
  await check("clear");
  book.undo();
  await check("undo clear");
  await recorder.pause();
  const replayCount = (await recorder.readDocument()).events.length;
  const ignored = line(book.nextSeq());
  book.addStrokes([ignored]);
  book.undo();
  const kept = line(book.nextSeq());
  book.addStrokes([kept]);
  const rows = await book.journalEdits(recorder.generation, recorder.savedDocumentRevision);
  assert(
    rows.length === 3 && !rows.some((row) => row.action.kind === "replace"),
    "Paused changes were not saved as individual commands.",
  );
  assert((await recorder.readDocument()).events.length === replayCount, "A paused edit appeared before resuming.");
  await recorder.resume(rows);
  await check("paused branch");
  book.undo();
  await check("undo after resuming");
  const playback = new PlaybackTimeline(await recorder.readDocument());
  const hidden = playback.frame(recorder.elapsed, false);
  assert(
    !hidden.layers.some((l) => l.strokes.some((s) => s.seq === ignored.seq || s.seq === kept.seq)),
    "Undone paused ink remained visible.",
  );
  await recorder.stop();
  await recorder.start(meta, { active: book.active.value, layers: book.layers.value }, false, book.revision());
  book.edit(book.active.value, [], [line(book.nextSeq())]);
  assert(await book.flush(), "Could not commit the document and its outbox.");
  assert(
    recorder.savedDocumentRevision < book.revision(),
    "Expected the document to commit before the delayed edit event.",
  );
  Object.assign(globalThis, { journalCount: book.strokeCount.value });
}

export function mountJournalProbe() {
  createApp({
    setup() {
      const book = useSketchbook();
      watch(book.ready, (ready) => {
        if (ready)
          void journal()
            .then(() => commands(book))
            .then(
              () => Object.assign(globalThis, { journalResult: "ok" }),
              (e) => Object.assign(globalThis, { journalResult: String(e) }),
            );
      });
      return () => h("p", "Checking drawing history");
    },
  }).mount();
}

export function mountCloseProbe() {
  createApp({
    setup() {
      const book = useSketchbook();
      book.onFlush(
        () => new Promise<void>(() => {}),
        (message) => Object.assign(globalThis, { journalCloseWarning: message }),
      );
      return () => h("p", { id: "book-state", "data-ready": String(book.ready.value) }, "Checking close timeout");
    },
  }).mount();
}
