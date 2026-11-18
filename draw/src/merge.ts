import type { Layer } from "./model";

/** A layer operator which depends on the destination needs compositing before a merge. */
export function rasterMerge(lower: Layer, upper: Layer): boolean {
  // A flattened image cannot retain paint concealed by the other layer.
  if (!lower.visible || !upper.visible) return false;
  return [lower, upper].some(
    (l) =>
      (l.blendMode ?? "normal") !== "normal" || l.clipping || l.alphaLocked || l.strokes.some((s) => s.alphaLocked),
  );
}
