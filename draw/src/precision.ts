import { clamp, STRIDE, type Stroke } from "./model";

export const coordinate16 = (value: number) => Math.round(value * 16) / 16;
export const pressure12 = (value: number) => Math.round(clamp(value, 0, 1) * 4095) / 4095;
export const fraction16 = (value: number) => Math.round(clamp(value, 0, 1) * 65535) / 65535;

export function canonicalPoint(
  x: number,
  y: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  twist: number,
  ms: number,
): [number, number, number, number, number, number, number] {
  return [
    coordinate16(x),
    coordinate16(y),
    pressure12(pressure),
    Math.round(clamp(tiltX, -90, 90)),
    Math.round(clamp(tiltY, -90, 90)),
    ((Math.round(twist) % 360) + 360) % 360,
    Math.max(0, Math.round(ms)),
  ];
}

/** Normalize existing document strokes at import. Live samples already use the same grid. */
export function canonicalStroke(stroke: Stroke): Stroke {
  const a = stroke.points;
  const points: number[] = [];
  const origin = a[6] ?? 0;
  for (let i = 0; i < a.length; i += STRIDE)
    points.push(
      ...canonicalPoint(
        a[i]!,
        a[i + 1]!,
        a[i + 2]!,
        a[i + 3]!,
        a[i + 4]!,
        a[i + 5]!,
        Math.max(points.at(-1) ?? 0, a[i + 6]! - origin),
      ),
    );
  const result = { ...stroke, points };
  for (const key of ["density", "scatter", "opacity", "hardness"] as const)
    if (stroke[key] !== undefined) result[key] = fraction16(stroke[key]);
  if (stroke.contours) result.contours = stroke.contours.map((ring) => ring.map(coordinate16));
  return result;
}
