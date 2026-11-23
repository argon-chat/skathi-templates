import { Patch, TextDiff, type DiffHunk, type PatchFile } from "skathi:text";

export type LineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  text: string;
  old: number | null;
  new: number | null;
  /** Index into the hunk's lines, as `Patch.select` takes it. */
  index: number;
  noNewline: boolean;
  /** Changed words, as [from, to) offsets into `text`. */
  words: [number, number][];
}

export interface HunkView {
  index: number;
  header: string;
  section: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  /** Unchanged lines between the previous hunk, or the start of the file, and this one. */
  before: number;
}

export interface FileDiff {
  patch: Patch | null;
  file: PatchFile | null;
  hunks: HunkView[];
  binary: boolean;
  /** The output passed the size limit; `lines` is what was read. */
  truncated: boolean;
  lineCount: number;
  added: number;
  removed: number;
  /** Digits of the largest line number, so every hunk's gutter is as wide. */
  digits: number;
  modeChange: string | null;
}

const INLINE_RUN_LIMIT = 200;
const INLINE_SHARE = 0.7;

function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  return starts;
}

function addRange(target: DiffLine[], starts: number[], from: number, to: number) {
  for (let i = 0; i < target.length; i++) {
    const s = starts[i]!;
    const e = s + target[i]!.text.length;
    if (to <= s || from >= e) continue;
    const a = Math.max(from, s) - s;
    const b = Math.min(to, e) - s;
    if (b > a) target[i]!.words.push([a, b]);
  }
}

function inline(dels: DiffLine[], adds: DiffLine[]) {
  if (!dels.length || !adds.length || dels.length > INLINE_RUN_LIMIT || adds.length > INLINE_RUN_LIMIT) return;
  const oldLines = dels.map((l) => l.text);
  const newLines = adds.map((l) => l.text);
  const oldStarts = lineStarts(oldLines);
  const newStarts = lineStarts(newLines);
  const changes = TextDiff.changes(oldLines.join("\n") + "\n", newLines.join("\n") + "\n", { inline: "words" });
  for (const change of changes) {
    for (const part of change.inline ?? []) {
      addRange(dels, oldStarts, part.oldFrom, part.oldTo);
      addRange(adds, newStarts, part.newFrom, part.newTo);
    }
  }
  for (const line of [...dels, ...adds]) {
    const marked = line.words.reduce((n, [a, b]) => n + b - a, 0);
    const visible = line.text.trim().length;
    if (visible === 0 || marked / Math.max(1, line.text.length) > INLINE_SHARE) line.words = [];
  }
}

/** A hunk that only inserts names the old line it follows, not the first one it covers. */
const firstOld = (h: DiffHunk) => (h.oldLines === 0 ? h.oldStart + 1 : h.oldStart);

function hunkView(file: PatchFile, index: number): HunkView {
  const hunk = file.hunks[index]!;
  const prev = file.hunks[index - 1];
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  hunk.lines.forEach((op, i) => {
    const kind: LineKind = op.op === "insert" ? "add" : op.op === "delete" ? "del" : "ctx";
    const line: DiffLine = {
      kind,
      text: op.text,
      old: kind === "add" ? null : oldNo++,
      new: kind === "del" ? null : newNo++,
      index: i,
      noNewline: op.noNewline === true,
      words: [],
    };
    if (kind === "add") added++;
    if (kind === "del") removed++;
    lines.push(line);
  });
  for (let i = 0; i < lines.length;) {
    if (lines[i]!.kind === "ctx") {
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    inline(dels, adds);
  }
  const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);
  return {
    index,
    header: `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`,
    section: hunk.section?.trim() ?? "",
    lines,
    added,
    removed,
    before: Math.max(0, firstOld(hunk) - (prev ? firstOld(prev) + prev.oldLines : 1)),
  };
}

const EMPTY: FileDiff = {
  patch: null,
  file: null,
  hunks: [],
  binary: false,
  truncated: false,
  lineCount: 0,
  added: 0,
  removed: 0,
  digits: 1,
  modeChange: null,
};

/** One file's `git diff` output as hunks of numbered lines with word highlights. */
export function fileDiff(text: string, truncated: boolean): FileDiff {
  if (truncated) return { ...EMPTY, truncated: true };
  if (!text.trim()) return EMPTY;
  const patch = Patch.parse(text);
  const file = patch.files[0];
  if (!file) return EMPTY;
  if (file.binary) return { ...EMPTY, patch, file, binary: true };
  const hunks = file.hunks.map((_, i) => hunkView(file, i));
  let lineCount = 0;
  let added = 0;
  let removed = 0;
  let last = 1;
  for (const h of hunks) {
    lineCount += h.lines.length;
    added += h.added;
    removed += h.removed;
    const end = h.lines.at(-1);
    last = Math.max(last, end?.old ?? 0, end?.new ?? 0);
  }
  const modeChange =
    file.oldMode !== undefined && file.newMode !== undefined && file.oldMode !== file.newMode
      ? `${file.oldMode.toString(8)} → ${file.newMode.toString(8)}`
      : null;
  return {
    patch,
    file,
    hunks,
    binary: false,
    truncated: false,
    lineCount,
    added,
    removed,
    digits: String(last).length,
    modeChange,
  };
}

/** The patch with only these hunks, or these lines of them, as `git apply` takes it; `undo` takes them back out. */
export function selection(diff: FileDiff, hunks: number[], lines: [number, number][], undo: boolean): string {
  if (!diff.patch) return "";
  return diff.patch.select([{ file: 0, hunks, lines }], { reverse: undo }).toString();
}
