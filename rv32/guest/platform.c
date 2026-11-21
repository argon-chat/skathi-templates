// doomgeneric's platform layer: every function is a call into the emulator.

#include <stdint.h>

#include "doomgeneric.h"
#include "host.h"
#include "i_video.h"

#define STACK_SIZE (256 * 1024)
#define MAX_ARGS 16

void guest_heap(uint8_t *limit);

void DG_Init(void) {}

void DG_DrawFrame(void) { host_call(HOST_FRAME, (long)DG_ScreenBuffer, (long)colors, 0, 0); }

void DG_SleepMs(uint32_t ms) { host_call(HOST_SLEEP, (long)ms, 0, 0, 0); }

uint32_t DG_GetTicksMs(void) { return (uint32_t)host_call(HOST_TICKS, 0, 0, 0, 0); }

int DG_GetKey(int *pressed, unsigned char *key)
{
    long event = host_call(HOST_KEY, 0, 0, 0, 0);
    if (!event) return 0;
    *pressed = (int)(event >> 8) & 1;
    *key = (unsigned char)event;
    return 1;
}

void DG_SetWindowTitle(const char *title) { (void)title; }

// The host hands over the top of memory in a0; the stack grows down from it and the heap up to it.
void guest_main(uint8_t *memory_top)
{
    static char line[256];
    static char *argv[MAX_ARGS];
    guest_heap(memory_top - STACK_SIZE);
    int argc = (int)host_call(HOST_ARGS, (long)line, sizeof line, 0, 0);
    if (argc > MAX_ARGS) argc = MAX_ARGS;
    char *next = line;
    for (int i = 0; i < argc; i++) {
        argv[i] = next;
        while (*next++) {}
    }
    doomgeneric_Create(argc, argv);
    for (;;) doomgeneric_Tick();
}
