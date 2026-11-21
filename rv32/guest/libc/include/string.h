#ifndef GUEST_STRING_H
#define GUEST_STRING_H

#include <stddef.h>

void *memcpy(void *to, const void *from, size_t size);
void *memmove(void *to, const void *from, size_t size);
void *memset(void *to, int value, size_t size);
int memcmp(const void *a, const void *b, size_t size);
void *memchr(const void *in, int value, size_t size);

size_t strlen(const char *text);
char *strcpy(char *to, const char *from);
char *strncpy(char *to, const char *from, size_t size);
char *strcat(char *to, const char *from);
char *strncat(char *to, const char *from, size_t size);
int strcmp(const char *a, const char *b);
int strncmp(const char *a, const char *b, size_t size);
int strcasecmp(const char *a, const char *b);
int strncasecmp(const char *a, const char *b, size_t size);
char *strchr(const char *text, int c);
char *strrchr(const char *text, int c);
char *strstr(const char *text, const char *part);
char *strdup(const char *text);

#endif
