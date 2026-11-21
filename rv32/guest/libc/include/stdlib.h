#ifndef GUEST_STDLIB_H
#define GUEST_STDLIB_H

#include <stddef.h>

void *malloc(size_t size);
void *calloc(size_t count, size_t size);
void *realloc(void *block, size_t size);
void free(void *block);

__attribute__((noreturn)) void exit(int code);
__attribute__((noreturn)) void abort(void);
int atexit(void (*handler)(void));
char *getenv(const char *name);
int system(const char *command);

int abs(int value);
int atoi(const char *text);
double atof(const char *text);
long strtol(const char *text, char **end, int base);
unsigned long strtoul(const char *text, char **end, int base);

#endif
