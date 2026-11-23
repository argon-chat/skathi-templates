import { discard } from "./git/repo";
import type { FileChange } from "./git/status";
import { ask } from "./ui";

export async function confirmDiscard(files: FileChange[]) {
  if (!files.length) return;
  const one = files.length === 1 ? files[0]! : null;
  const untracked = files.every((f) => f.kind === "untracked");
  const yes = await ask(
    one ? `Discard changes to ${one.path.split("/").pop()}?` : `Discard ${files.length} changes?`,
    untracked
      ? `${one ? "The file" : "The untracked files"} will be deleted. This cannot be undone.`
      : "Your changes in the working tree will be lost. This cannot be undone.",
    untracked ? "Delete" : "Discard",
  );
  if (yes) await discard(files);
}
