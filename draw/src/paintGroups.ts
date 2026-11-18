export interface PaintGroup<T> {
  children: (T | PaintGroup<T>)[];
}
export function paintGroups<T extends { scope?: readonly number[] }>(items: readonly T[]): (T | PaintGroup<T>)[] {
  interface Branch extends PaintGroup<T> {
    byId: Map<number, Branch>;
  }
  const root: Branch = { children: [], byId: new Map() };
  for (const item of items) {
    let branch = root;
    for (const id of item.scope ?? []) {
      let child = branch.byId.get(id);
      if (!child) {
        child = { children: [], byId: new Map() };
        branch.children.push(child);
        branch.byId.set(id, child);
      }
      branch = child;
    }
    branch.children.push(item);
  }
  return root.children;
}
