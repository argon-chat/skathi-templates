#ifndef GUEST_STDIO_H
#define GUEST_STDIO_H

#include <stdarg.h>
#include <stddef.h>

typedef struct guest_file FILE;

extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;

#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2

int printf(const char *format, ...);
int fprintf(FILE *file, const char *format, ...);
int sprintf(char *out, const char *format, ...);
int snprintf(char *out, size_t size, const char *format, ...);
int vprintf(const char *format, va_list args);
int vfprintf(FILE *file, const char *format, va_list args);
int vsnprintf(char *out, size_t size, const char *format, va_list args);
int sscanf(const char *text, const char *format, ...);
int fscanf(FILE *file, const char *format, ...);
int puts(const char *text);
int putchar(int c);
int fputs(const char *text, FILE *file);
int fputc(int c, FILE *file);

FILE *fopen(const char *path, const char *mode);
int fclose(FILE *file);
size_t fread(void *out, size_t size, size_t count, FILE *file);
size_t fwrite(const void *data, size_t size, size_t count, FILE *file);
int fseek(FILE *file, long offset, int whence);
long ftell(FILE *file);
int fflush(FILE *file);
int feof(FILE *file);
char *fgets(char *out, int size, FILE *file);
int remove(const char *path);
int rename(const char *from, const char *to);

#endif
