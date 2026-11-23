import { appFiles } from "skathi:app";
import { notify, open } from "./git/repo";

export async function chooseFolder() {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await showDirectoryPicker();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    notify("error", "Could not open the folder picker", e instanceof Error ? e.message : String(e));
    return;
  }
  const path = appFiles.getPathForFile(handle);
  if (path) await open(path);
}

export async function openDropped(event: DragEvent) {
  const item = event.dataTransfer?.files[0];
  if (!item) return;
  const path = appFiles.getPathForFile(item);
  if (path) await open(path);
}
