export type Kind = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted" | "typechange";

export interface FileChange {
  path: string;
  /** For a rename or copy: where it came from. */
  from?: string;
  kind: Kind;
  staged: boolean;
}

export interface Branch {
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface Status {
  branch: Branch;
  unstaged: FileChange[];
  staged: FileChange[];
}

const KIND: Record<string, Kind> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
};

const byPath = (a: FileChange, b: FileChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** `git status --porcelain=v2 -z --branch`. */
export function parseStatus(out: string): Status {
  const branch: Branch = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const unstaged: FileChange[] = [];
  const staged: FileChange[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (!entry) continue;
    const type = entry[0];
    if (type === "#") {
      const [, key, ...rest] = entry.split(" ");
      const value = rest.join(" ");
      if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }
    if (type === "?") {
      unstaged.push({ path: entry.slice(2), kind: "untracked", staged: false });
      continue;
    }
    if (type === "u") {
      const path = entry.split(" ").slice(10).join(" ");
      unstaged.push({ path, kind: "conflicted", staged: false });
      continue;
    }
    if (type !== "1" && type !== "2") continue;
    const fields = entry.split(" ");
    const xy = fields[1] ?? "..";
    const path = fields.slice(type === "1" ? 8 : 9).join(" ");
    const from = type === "2" ? parts[++i] : undefined;
    const x = xy[0]!;
    const y = xy[1]!;
    if (x !== ".") {
      const change: FileChange = { path, kind: KIND[x] ?? "modified", staged: true };
      if (from !== undefined && (x === "R" || x === "C")) change.from = from;
      staged.push(change);
    }
    if (y !== ".") unstaged.push({ path, kind: KIND[y] ?? "modified", staged: false });
  }
  unstaged.sort(byPath);
  staged.sort(byPath);
  return { branch, unstaged, staged };
}
