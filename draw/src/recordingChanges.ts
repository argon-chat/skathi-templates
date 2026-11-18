import type { DrawAction, DrawAtomic, DrawMutation, DrawUi } from "./events";
import type { Layer, Stroke, Symmetry } from "./model";

export interface JournalEdit {
  generation: number;
  revision: number;
  at: number;
  action: DrawAction;
}

function sameSymmetry(a?: Symmetry | null, b?: Symmetry | null) {
  return a === b || (!!a && !!b && a.mirror === b.mirror && a.segments === b.segments && a.x === b.x && a.y === b.y);
}

export function uiChanges(before: DrawUi, after: DrawUi): DrawUi[] {
  const changes: DrawUi[] = [];
  if (after.mode !== undefined && before.mode !== after.mode) changes.push({ mode: after.mode });
  if (after.shape !== undefined && before.shape !== after.shape) changes.push({ shape: after.shape });
  if (after.color !== undefined && before.color !== after.color) changes.push({ color: after.color });
  if (after.size !== undefined && before.size !== after.size) changes.push({ size: after.size });
  if (after.active !== undefined && before.active !== after.active) changes.push({ active: after.active });
  if (after.paper !== undefined && before.paper !== after.paper) changes.push({ paper: after.paper });
  if (after.dark !== undefined && before.dark !== after.dark) changes.push({ dark: after.dark });
  if (after.symmetry !== undefined && !sameSymmetry(before.symmetry, after.symmetry))
    changes.push({ symmetry: after.symmetry && { ...after.symmetry } });
  return changes;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Uint8Array && b instanceof Uint8Array) return a.length === b.length && a.every((v, i) => b[i] === v);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return (
    Object.keys(left).every((k) => equal(left[k], right[k])) &&
    Object.keys(right).every((k) => k in left || right[k] === undefined)
  );
}

export function reconcileDrawing(before: readonly Layer[], after: readonly Layer[], active: string): DrawMutation {
  const changes: DrawAtomic[] = [];
  const order = before.map((l) => l.id);
  for (const l of before)
    if (!after.some((a) => a.id === l.id)) {
      changes.push({ kind: "delete-layer", id: l.id });
      order.splice(order.indexOf(l.id), 1);
    }
  for (const [i, l] of after.entries()) {
    const previous = before.find((b) => b.id === l.id);
    if (!previous) {
      changes.push({ kind: "add-layer", index: i, layer: { ...l, strokes: [] } });
      order.splice(i, 0, l.id);
    } else {
      const idx = order.indexOf(l.id);
      if (idx !== i) {
        changes.push({ kind: "move-layer", from: idx, to: i });
        order.splice(i, 0, ...order.splice(idx, 1));
      }
      const properties = (layer: Layer) => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        alphaLocked: layer.alphaLocked ?? false,
        blendMode: layer.blendMode ?? "normal",
        clipping: layer.clipping ?? false,
      });
      if (!equal(properties(previous), properties(l)))
        changes.push({ kind: "layer", id: l.id, changes: properties(l) });
    }
    const old = new Map(previous?.strokes.map((s) => [s.seq, s]));
    const comparable = (s: Stroke) => ({
      ...s,
      color: s.color.toLowerCase(),
      opacity: s.opacity ?? 1,
      seed: s.seed ?? s.seq,
    });
    const added = l.strokes.filter((s) => {
      const original = old.get(s.seq);
      if (!original || (original !== s && !equal(comparable(original), comparable(s)))) return true;
      old.delete(s.seq);
      return false;
    });
    if (old.size || added.length) changes.push({ kind: "edit", layer: l.id, removed: [...old.keys()], added });
  }
  return { kind: "group", changes, active };
}
