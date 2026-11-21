// Fetches the game data the guest runs: `doom1.wad`, the shareware episode of Doom 1.9, taken
// unchanged from Debian's doom-wad-shareware source package. It is not part of this template:
// id Software lets the shareware WAD be given away free of charge, not sold or modified.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ARCHIVE = "doom-wad-shareware_1.9.fixed.orig.tar.gz";
const SOURCES = [
  `https://deb.debian.org/debian/pool/non-free/d/doom-wad-shareware/${ARCHIVE}`,
  `https://snapshot.debian.org/file/a2d5964a84235eb60119f213b2cdf7f748672744/${ARCHIVE}`,
];
const SHA256 = "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771";
const target = fileURLToPath(new URL("../assets/doom1.wad", import.meta.url));

const genuine = (bytes) => createHash("sha256").update(bytes).digest("hex") === SHA256;

/** The file named `name` in a tar archive, or null. */
function fromTar(tar, name) {
  for (let at = 0; at + 512 <= tar.length; ) {
    const entry = tar.subarray(at, at + 100).toString("latin1").replace(/\0.*$/, "");
    if (!entry) return null;
    const size = parseInt(tar.subarray(at + 124, at + 136).toString("latin1"), 8) || 0;
    if (entry.endsWith(name)) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function download() {
  let why = "";
  for (const url of SOURCES) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const wad = fromTar(gunzipSync(Buffer.from(await response.arrayBuffer())), "doom1.wad");
      if (!wad || !genuine(wad)) throw new Error("the archive does not hold the expected doom1.wad");
      return wad;
    } catch (error) {
      why = `${url}: ${error instanceof Error ? error.message : error}`;
    }
  }
  throw new Error(why);
}

if (existsSync(target) && genuine(readFileSync(target))) {
  console.log("assets/doom1.wad is in place");
} else {
  try {
    const wad = await download();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, wad);
    console.log("assets/doom1.wad fetched (the Doom 1.9 shareware episode, 4.0 MB)");
  } catch (error) {
    // An install does not fail over the game data: the workbench says what is missing.
    console.warn(
      `assets/doom1.wad was not fetched (${error instanceof Error ? error.message : error}).\n` +
        "Run `bun run wad` when you are online, or put your own doom1.wad into assets/.",
    );
  }
}
