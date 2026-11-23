// Lanes for the commit graph, laid out one commit at a time in log order (children before parents), so
// each page of a long history extends the layout without touching the rows before it.

export interface Segment {
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  lane: number;
  color: number;
  /** From the row's top edge to its middle. */
  up: Segment[];
  /** From the row's middle to its bottom edge. */
  down: Segment[];
  merge: boolean;
}

interface Track {
  sha: string;
  color: number;
}

export const LANE_COLORS = 8;

export class Graph {
  readonly rows: GraphRow[] = [];
  /** The most lanes any row uses. */
  width = 1;
  private lanes: (Track | null)[] = [];
  private nextColor = 0;

  private free(skip = -1): number {
    for (let i = 0; i < this.lanes.length; i++) if (!this.lanes[i] && i !== skip) return i;
    return this.lanes.length === skip ? skip + 1 : this.lanes.length;
  }

  private color(): number {
    return this.nextColor++ % LANE_COLORS;
  }

  extend(commits: readonly { sha: string; parents: string[] }[]) {
    for (let r = this.rows.length; r < commits.length; r++) this.add(commits[r]!);
  }

  private add(commit: { sha: string; parents: string[] }) {
    const lanes = this.lanes;
    const up: Segment[] = [];
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      const t = lanes[i];
      if (!t) continue;
      if (t.sha === commit.sha) {
        if (lane < 0) lane = i;
        up.push({ from: i, to: lane, color: t.color });
      } else {
        up.push({ from: i, to: i, color: t.color });
      }
    }
    let color: number;
    if (lane < 0) {
      lane = this.free();
      color = this.color();
    } else {
      color = lanes[lane]!.color;
    }
    for (let i = 0; i < lanes.length; i++) if (i !== lane && lanes[i]?.sha === commit.sha) lanes[i] = null;

    const down: Segment[] = [];
    const linked = new Set<number>();
    const [first, ...rest] = commit.parents;
    if (first) {
      lanes[lane] = { sha: first, color };
      linked.add(lane);
      down.push({ from: lane, to: lane, color });
    } else {
      lanes[lane] = null;
    }
    for (const parent of rest) {
      let target = lanes.findIndex((t) => t?.sha === parent);
      if (target < 0) {
        target = this.free(lane);
        lanes[target] = { sha: parent, color: this.color() };
      }
      if (!linked.has(target)) {
        linked.add(target);
        down.push({ from: lane, to: target, color: lanes[target]!.color });
      }
    }
    for (let i = 0; i < lanes.length; i++) {
      const t = lanes[i];
      if (t && i !== lane && up.some((s) => s.to === i && s.from === i)) down.push({ from: i, to: i, color: t.color });
    }
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
    this.width = Math.max(this.width, lanes.length, lane + 1);
    this.rows.push({ lane, color, up, down, merge: commit.parents.length > 1 });
  }
}
