#ifndef GUEST_HOST_H
#define GUEST_HOST_H

// The calls the emulator answers: the number goes in a7, arguments in a0-a3, the result comes back in a0.
enum {
    HOST_EXIT = 1,
    HOST_WRITE = 2,
    HOST_OPEN = 3,
    HOST_READ = 4,
    HOST_SIZE = 5,
    HOST_TICKS = 6,
    HOST_SLEEP = 7,
    HOST_FRAME = 8,
    HOST_KEY = 9,
    HOST_ARGS = 10,
};

static inline long host_call(long number, long a, long b, long c, long d)
{
    register long a0 __asm__("a0") = a;
    register long a1 __asm__("a1") = b;
    register long a2 __asm__("a2") = c;
    register long a3 __asm__("a3") = d;
    register long a7 __asm__("a7") = number;
    __asm__ volatile("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a3), "r"(a7) : "memory");
    return a0;
}

#endif
