import type { Layer, Stroke, Tool } from "./model";

type XY = [number, number];
type Curve = [XY, XY, XY, XY];
type Draft = Layer & { strokes: Stroke[] };
const count = 20;
const pi = Math.PI;
// The study was drawn on a 1440 × 960 sheet; the document's origin is its centre.
const cx = 720;
const cy = 500;

function bezier([a, b, c, d]: Curve, t: number): XY {
  const s = 1 - t;
  return [
    s ** 3 * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t ** 3 * d[0],
    s ** 3 * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t ** 3 * d[1],
  ];
}

/** California poppies on three layers, drawn with every tool. */
export function poppyStudy(nextSeq: () => number): Layer[] {
  function mark(
    layer: Draft,
    color: string,
    width: number,
    path: (t: number) => XY,
    pressure = (t: number) => 0.28 + 0.55 * Math.sin(pi * t),
    tool: Tool = "pen",
  ) {
    const points: number[] = [];
    for (let i = 0; i <= count; i++) {
      const [x, y] = path(i / count);
      points.push(x - cx, y - cy, pressure(i / count), 0, 0, 0, i * 4);
    }
    layer.strokes.push({ seq: nextSeq(), tool, color, width, points });
  }

  function line(layer: Draft, curve: Curve, color: string, width: number) {
    mark(layer, color, width, (t) => bezier(curve, t));
  }

  const makeLayer = (id: string, name: string): Draft => ({ id, name, visible: true, strokes: [] });
  const stems = makeLayer("stems", "Stems & foliage");
  const petals = makeLayer("pigment", "Petal washes");
  const ink = makeLayer("ink", "Fine details");
  const green = "#50745e";
  const jade = "#89a17b";
  const deep = "#456453";

  function stem(curve: Curve, width: number) {
    line(stems, curve, green, width);
    mark(stems, jade, width * 0.28, (t) => {
      const [x, y] = bezier(curve, t);
      return [x - width * 0.22, y];
    });
  }
  stem(
    [
      [641, 864],
      [707, 676],
      [704, 482],
      [650, 312],
    ],
    11,
  );
  stem(
    [
      [646, 861],
      [704, 708],
      [862, 637],
      [929, 484],
    ],
    8,
  );
  stem(
    [
      [661, 804],
      [658, 722],
      [503, 657],
      [462, 536],
    ],
    7,
  );
  stem(
    [
      [650, 834],
      [710, 680],
      [764, 452],
      [861, 293],
    ],
    5,
  );

  function frond(curve: Curve, size: number, flip: number) {
    line(stems, curve, green, 3.8);
    for (let i = 1; i <= 7; i++) {
      const t = i / 8;
      const [x, y] = bezier(curve, t);
      const length = (1 - t * 0.62) * size;
      for (const side of [-1, 1]) {
        const dx = (flip * 0.4 + side * 0.78) * length;
        const end: XY = [x + dx, y - length * (side === flip ? 0.47 : 0.94)];
        const blade: Curve = [[x, y], [x + dx * 0.34, y - 3], [end[0] - dx * 0.22, end[1] + 9], end];
        line(stems, blade, side === flip ? green : jade, 5.6);
        const [nx, ny] = bezier(blade, 0.52);
        line(
          stems,
          [
            [nx, ny],
            [nx + dx * 0.15, ny - 4],
            [nx + dx * 0.32, ny - 16],
            [nx + dx * 0.35, ny - length * 0.66],
          ],
          green,
          3.1,
        );
      }
    }
  }
  frond(
    [
      [671, 769],
      [632, 726],
      [539, 726],
      [493, 674],
    ],
    61,
    -1,
  );
  frond(
    [
      [686, 695],
      [724, 664],
      [738, 627],
      [785, 594],
    ],
    52,
    1,
  );
  frond(
    [
      [691, 597],
      [633, 574],
      [629, 526],
      [589, 489],
    ],
    44,
    -1,
  );
  frond(
    [
      [811, 636],
      [853, 626],
      [897, 643],
      [944, 596],
    ],
    47,
    1,
  );

  function bud(x: number, y: number, angle: number, s: number) {
    const path = (t: number): XY => [
      x + Math.sin(angle) * t * 67 * s + Math.sin(t * pi) * 4,
      y - Math.cos(angle) * t * 67 * s,
    ];
    mark(stems, deep, s * 19, path, (t) => 0.03 + 0.92 * Math.sin(t * pi) ** 0.75);
    mark(ink, jade, s * 3, (t) => {
      const [a, b] = path(t);
      return [a - 4 * s * Math.sin(pi * t), b];
    });
  }
  bud(861, 293, 0.58, 1);
  line(
    stems,
    [
      [851, 310],
      [871, 276],
      [901, 278],
      [913, 304],
    ],
    green,
    3.2,
  );
  bud(913, 304, 2.65, 0.55);

  function flower(x: number, y: number, scale: number, tilt: number, open: number) {
    const transform = (u: number, v: number): XY => [
      x + scale * (u * Math.cos(tilt) - v * Math.sin(tilt)),
      y + scale * (u * Math.sin(tilt) + v * Math.cos(tilt)),
    ];
    const colors = [
      ["#c25239", "#da6743", "#e98551", "#f0a763"],
      ["#d96740", "#f18b48", "#f4a552", "#f6bc74"],
      ["#bb4837", "#db6040", "#ec7a48", "#f49a5c"],
      ["#d85c38", "#ed8043", "#f2a253", "#f7b969"],
    ];
    function petal(a: number, length: number, breadth: number, bend: number, origin: XY, hues: string[]) {
      const contour = (t: number, lane: number): XY => {
        const wave = Math.sin(pi * t);
        const fan = Math.pow(Math.max(0, wave), 0.52) * (0.5 + 0.72 * t);
        const along = length * t + 4 * wave * Math.sin(lane * 4 + t * 2) + (3 + lane) * wave * Math.cos(lane * 6);
        const across = bend * Math.sin(t * pi * 0.87) + breadth * lane * fan;
        return transform(
          origin[0] + Math.cos(a) * along - Math.sin(a) * across,
          origin[1] + Math.sin(a) * along + Math.cos(a) * across,
        );
      };
      for (let i = 0; i <= 12; i++) {
        const lane = (i - 6) / 6;
        const shade = i < 2 ? 0 : i < 5 || i === 7 ? 1 : i < 10 ? 2 : 3;
        mark(
          petals,
          hues[shade]!,
          scale * breadth * 0.45,
          (t) => contour(t, lane),
          (t) => 0.02 + 0.7 * Math.pow(Math.sin(pi * t), 0.54) * (0.52 + 0.75 * t),
        );
      }
      for (const lane of [-0.88, -0.61, -0.32, 0.18, 0.52, 0.78]) {
        mark(petals, lane < 0 ? hues[0]! : hues[3]!, scale * 1.8, (t) =>
          contour(0.12 + t * (0.76 + lane * 0.09), lane + Math.sin(t * 4) * 0.035),
        );
      }
    }
    petal(-2.18, 143, 58, -23, [-7, 3], colors[0]!);
    petal(-1.47, 164, 63, -7, [-1, -7], colors[1]!);
    petal(-0.61, 151, 63, 10, [7, -4], colors[2]!);
    petal(-2.75, 142, 56, -13, [-9, 4], colors[1]!);
    for (let i = 0; i < 25; i++) {
      const a = -pi * 0.95 + pi * 0.9 * (i / 24);
      const r = 18 + 13 * (0.5 + Math.sin(i * 19.2) * 0.5);
      const o = transform(-3 + i * 0.45, 0);
      const p = transform(Math.cos(a) * r, Math.sin(a) * r * open - 6);
      line(ink, [o, o, p, p], "#9f6030", scale * 2);
      ink.strokes.push({
        seq: nextSeq(),
        tool: "pen",
        color: i % 4 ? "#d59b38" : "#ecb94d",
        width: scale * (4 + (i % 3)),
        points: [p[0] - cx, p[1] - cy, 0.76, 0, 0, 0, 0],
      });
    }
    petal(0.07 + open * 0.12, 116, 35, -19, [0, 9], colors[3]!);
    petal(-2.92, 97, 29, -15, [-4, 12], colors[2]!);
    const fold = (t: number): XY => transform(-14 - 60 * t, -15 - 48 * t + 18 * t * t);
    mark(petals, "#e5894a", scale * 7, fold, () => 0.5, "marker");
    mark(
      petals,
      "#000000",
      scale * 1.8,
      (t) => transform(-22 - 34 * t, -23 - 27 * t + 6 * t * t),
      (t) => 0.55 * Math.sin(pi * t),
      "eraser",
    );
    mark(
      ink,
      "#a8553e",
      scale * 3,
      (t) => transform(8 + 79 * t, 13 + 5 * Math.sin(t * pi)),
      (t) => 0.7 * Math.sin(pi * t),
      "pencil",
    );
    mark(
      ink,
      "#a44e38",
      scale * 2.6,
      (t) => transform(-7 - 42 * t, 10 + 4 * Math.sin(t * pi)),
      (t) => 0.83 * Math.sin(pi * t),
      "brush",
    );
  }

  flower(650, 312, 1.24, -0.1, 1);
  flower(929, 484, 0.82, 0.54, 0.78);
  flower(462, 536, 0.64, -0.59, 0.66);
  return [stems, petals, ink];
}
