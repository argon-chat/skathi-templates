    .section .text.start, "ax"
    .globl _start
_start:
    mv sp, a0
    call guest_main
1:  j 1b
