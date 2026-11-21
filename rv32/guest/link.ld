ENTRY(_start)

SECTIONS
{
    . = 0x10000;
    .text : { *(.text.start) *(.text .text.*) }
    .rodata : ALIGN(16) { *(.rodata .rodata.* .srodata .srodata.*) }
    .data : ALIGN(16) { *(.data .data.* .sdata .sdata.*) }
    _edata = .;
    /* Not in the image: the emulator's memory starts out zeroed. */
    .bss (NOLOAD) : ALIGN(16) { *(.bss .bss.* .sbss .sbss.* COMMON) }
    _end = .;
    /DISCARD/ : { *(.comment) *(.note.*) *(.eh_frame) *(.riscv.attributes) }
}
