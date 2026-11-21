#Requires -Version 7.0
# Builds the guest image: doomgeneric for a bare RV32IM machine, as a flat binary loaded at 0x10000.
# Needs zig (0.16) and git on PATH.  -Out is where doom.bin goes.
param(
    [string]$Engine = "",
    [string]$Out = (Join-Path $PSScriptRoot "../assets"),
    [string]$Optimize = "-O2"
)
$ErrorActionPreference = "Stop"

$commit = "e257a09527062bfb986b6e5e0780839b6cbd5b71"
$work = Join-Path $PSScriptRoot "build"
New-Item -ItemType Directory -Force $work, $Out | Out-Null

if (-not $Engine) {
    $Engine = Join-Path $work "doomgeneric"
    if (-not (Test-Path $Engine)) {
        git clone --quiet https://github.com/ozkl/doomgeneric $Engine
        if ($LASTEXITCODE) { throw "git clone failed" }
    }
    git -C $Engine checkout --quiet $commit
    if ($LASTEXITCODE) { throw "doomgeneric has no commit $commit" }
}
$source = Join-Path $Engine "doomgeneric"

$units = @(
    "dummy", "am_map", "doomdef", "doomstat", "dstrings", "d_event", "d_items", "d_iwad", "d_loop", "d_main", "d_mode",
    "d_net", "f_finale", "f_wipe", "g_game", "hu_lib", "hu_stuff", "info", "i_cdmus", "i_endoom", "i_joystick",
    "i_scale", "i_sound", "i_system", "i_timer", "memio", "m_argv", "m_bbox", "m_cheat", "m_config", "m_controls",
    "m_fixed", "m_menu", "m_misc", "m_random", "p_ceilng", "p_doors", "p_enemy", "p_floor", "p_inter", "p_lights",
    "p_map", "p_maputl", "p_mobj", "p_plats", "p_pspr", "p_saveg", "p_setup", "p_sight", "p_spec", "p_switch",
    "p_telept", "p_tick", "p_user", "r_bsp", "r_data", "r_draw", "r_main", "r_plane", "r_segs", "r_sky", "r_things",
    "sha1", "sounds", "statdump", "st_lib", "st_stuff", "s_sound", "tables", "v_video", "wi_stuff", "w_checksum",
    "w_file", "w_main", "w_wad", "z_zone", "w_file_stdc", "i_input", "i_video", "doomgeneric"
) | ForEach-Object { Join-Path $source "$_.c" }

$elf = Join-Path $work "doom.elf"
$flags = @(
    "-target", "riscv32-freestanding", "-mcpu=generic_rv32+m", "-mabi=ilp32", $Optimize,
    "-ffreestanding", "-fno-builtin", "-fno-sanitize=undefined", "-mno-relax", "-w",
    "-DCMAP256", "-DDOOMGENERIC_RESX=320", "-DDOOMGENERIC_RESY=200",
    "-isystem", (Join-Path $PSScriptRoot "libc/include"), "-I", $source,
    # The engine's error messages carry __FILE__: without this the image would differ with the checkout's path.
    "-ffile-prefix-map=$source=doomgeneric", "-ffile-prefix-map=$PSScriptRoot=guest",
    "-Wl,-T,$(Join-Path $PSScriptRoot 'link.ld')", "-Wl,--gc-sections", "-ffunction-sections"
)
zig cc @flags -o $elf (Join-Path $PSScriptRoot "start.S") (Join-Path $PSScriptRoot "platform.c") `
    (Join-Path $PSScriptRoot "libc/libc.c") @units
if ($LASTEXITCODE) { throw "zig cc failed" }

$bin = Join-Path $Out "doom.bin"
zig objcopy -O binary $elf $bin
if ($LASTEXITCODE) { throw "zig objcopy failed" }
"{0}: {1:N0} bytes" -f $bin, (Get-Item $bin).Length
