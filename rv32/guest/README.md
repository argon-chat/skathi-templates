# The guest image

`assets/doom.bin` is [doomgeneric](https://github.com/ozkl/doomgeneric) built for a bare RV32IM machine: no
operating system, no C library but the small one in `libc/`. The emulator loads it at `0x10000`, puts the size of
memory in `a0` and jumps to its first instruction. Everything the game needs from outside (the screen, the clock,
keys, the WAD file) is an `ecall`; `host.h` lists them.

## Building

Needs [zig](https://ziglang.org/download/) 0.16 and git on `PATH`, and PowerShell 7.

```
pwsh guest/build.ps1
```

The script clones doomgeneric at the commit it names into `guest/build/`, compiles it with
`zig cc -target riscv32-freestanding -mcpu=generic_rv32+m` together with `start.S`, `platform.c` and `libc/libc.c`,
links with `link.ld`, and writes the flat binary to `assets/doom.bin`. `-Engine <dir>` uses a checkout you already
have; `-Optimize -Os` trades a little speed for a smaller image.

## The game data

The guest reads `assets/doom1.wad`, the shareware episode of Doom 1.9. It is not in this template:
`bun install` runs `scripts/fetch-wad.mjs`, which takes the file, unchanged, from Debian's
[doom-wad-shareware](https://packages.debian.org/stable/doom-wad-shareware) source package and checks its
SHA-256. `bun run wad` fetches it again, and any other `doom1.wad` you put there is used as it is.

id Software lets the shareware WAD be given away free of charge. It may not be sold or changed, so an app you
charge for cannot include it: ship your own guest and data, or let the user supply the WAD.

## What the machine does not have

- Sound. The engine is built with its silent sound module, and there is no host call for samples. Adding it means
  a sound module in `platform.c` that hands the mixed buffer to a new host call, and an `AudioContext` on the
  other side to play it.
- A mouse or a gamepad: the keyboard is the only input, mapped in `src/keys.ts`.
- Files to write. `fopen` in `libc/libc.c` opens for reading only, so the game keeps neither settings nor saved
  games.

## Licences

| Part                                                        | Version                                           | Licence                                            |
| ----------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| doomgeneric (the engine in doom.bin)                        | commit `e257a09527062bfb986b6e5e0780839b6cbd5b71` | GPL-2.0, `licenses/doomgeneric-GPL-2.0.txt`        |
| `doom1.wad` (fetched at install, not part of the template)  | Doom 1.9 shareware                                | id Software's shareware licence: free to pass on   |
| compiler-rt (soft float, 64-bit division, linked in by zig) | zig 0.16.0                                        | MIT                                                |

`doom.bin` is a GPL-2.0 binary: whoever ships it has to offer its source, which is doomgeneric at that commit plus
the files in this directory.
