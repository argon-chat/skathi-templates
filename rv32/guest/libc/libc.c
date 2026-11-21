// The part of the C library doomgeneric uses, over the host calls in host.h.

#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "../host.h"

int errno;

void *memcpy(void *to, const void *from, size_t size)
{
    uint8_t *d = to;
    const uint8_t *s = from;
    if ((((uintptr_t)d | (uintptr_t)s) & 3) == 0) {
        uint32_t *dw = (uint32_t *)d;
        const uint32_t *sw = (const uint32_t *)s;
        for (; size >= 16; size -= 16, dw += 4, sw += 4) {
            dw[0] = sw[0];
            dw[1] = sw[1];
            dw[2] = sw[2];
            dw[3] = sw[3];
        }
        for (; size >= 4; size -= 4) *dw++ = *sw++;
        d = (uint8_t *)dw;
        s = (const uint8_t *)sw;
    }
    while (size--) *d++ = *s++;
    return to;
}

void *memmove(void *to, const void *from, size_t size)
{
    uint8_t *d = to;
    const uint8_t *s = from;
    if (d <= s || d >= s + size) return memcpy(to, from, size);
    while (size--) d[size] = s[size];
    return to;
}

void *memset(void *to, int value, size_t size)
{
    uint8_t *d = to;
    while (size && ((uintptr_t)d & 3)) {
        *d++ = (uint8_t)value;
        size--;
    }
    uint32_t word = (uint8_t)value * 0x01010101u;
    uint32_t *dw = (uint32_t *)d;
    for (; size >= 16; size -= 16, dw += 4) {
        dw[0] = word;
        dw[1] = word;
        dw[2] = word;
        dw[3] = word;
    }
    for (; size >= 4; size -= 4) *dw++ = word;
    d = (uint8_t *)dw;
    while (size--) *d++ = (uint8_t)value;
    return to;
}

int memcmp(const void *a, const void *b, size_t size)
{
    const uint8_t *x = a, *y = b;
    for (; size--; x++, y++)
        if (*x != *y) return *x - *y;
    return 0;
}

void *memchr(const void *in, int value, size_t size)
{
    const uint8_t *p = in;
    for (; size--; p++)
        if (*p == (uint8_t)value) return (void *)p;
    return NULL;
}

size_t strlen(const char *text)
{
    const char *end = text;
    while (*end) end++;
    return (size_t)(end - text);
}

char *strcpy(char *to, const char *from)
{
    char *d = to;
    while ((*d++ = *from++)) {}
    return to;
}

char *strncpy(char *to, const char *from, size_t size)
{
    size_t i = 0;
    for (; i < size && from[i]; i++) to[i] = from[i];
    for (; i < size; i++) to[i] = 0;
    return to;
}

char *strcat(char *to, const char *from)
{
    strcpy(to + strlen(to), from);
    return to;
}

char *strncat(char *to, const char *from, size_t size)
{
    char *d = to + strlen(to);
    while (size-- && *from) *d++ = *from++;
    *d = 0;
    return to;
}

int strcmp(const char *a, const char *b)
{
    for (; *a && *a == *b; a++, b++) {}
    return (uint8_t)*a - (uint8_t)*b;
}

int strncmp(const char *a, const char *b, size_t size)
{
    for (; size; size--, a++, b++) {
        if (*a != *b || !*a) return (uint8_t)*a - (uint8_t)*b;
    }
    return 0;
}

int strcasecmp(const char *a, const char *b)
{
    for (; *a && tolower((uint8_t)*a) == tolower((uint8_t)*b); a++, b++) {}
    return tolower((uint8_t)*a) - tolower((uint8_t)*b);
}

int strncasecmp(const char *a, const char *b, size_t size)
{
    for (; size; size--, a++, b++) {
        int x = tolower((uint8_t)*a), y = tolower((uint8_t)*b);
        if (x != y || !x) return x - y;
    }
    return 0;
}

char *strchr(const char *text, int c)
{
    for (;; text++) {
        if (*text == (char)c) return (char *)text;
        if (!*text) return NULL;
    }
}

char *strrchr(const char *text, int c)
{
    const char *found = NULL;
    for (;; text++) {
        if (*text == (char)c) found = text;
        if (!*text) return (char *)found;
    }
}

char *strstr(const char *text, const char *part)
{
    size_t n = strlen(part);
    for (; *text; text++)
        if (strncmp(text, part, n) == 0) return (char *)text;
    return n ? NULL : (char *)text;
}

char *strdup(const char *text)
{
    size_t n = strlen(text) + 1;
    char *copy = malloc(n);
    if (copy) memcpy(copy, text, n);
    return copy;
}

int isspace(int c) { return c == ' ' || (c >= '\t' && c <= '\r'); }
int isdigit(int c) { return c >= '0' && c <= '9'; }
int isupper(int c) { return c >= 'A' && c <= 'Z'; }
int islower(int c) { return c >= 'a' && c <= 'z'; }
int isalpha(int c) { return isupper(c) || islower(c); }
int isalnum(int c) { return isalpha(c) || isdigit(c); }
int isprint(int c) { return c >= 0x20 && c < 0x7f; }
int isxdigit(int c) { return isdigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
int toupper(int c) { return islower(c) ? c - 32 : c; }
int tolower(int c) { return isupper(c) ? c + 32 : c; }

int abs(int value) { return value < 0 ? -value : value; }
double fabs(double value) { return value < 0 ? -value : value; }

static int digit_of(int c)
{
    if (isdigit(c)) return c - '0';
    if (isalpha(c)) return tolower(c) - 'a' + 10;
    return 99;
}

unsigned long strtoul(const char *text, char **end, int base)
{
    const char *p = text;
    while (isspace((uint8_t)*p)) p++;
    int negative = 0;
    if (*p == '-' || *p == '+') negative = *p++ == '-';
    if ((base == 0 || base == 16) && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) {
        p += 2;
        base = 16;
    } else if (base == 0) {
        base = *p == '0' ? 8 : 10;
    }
    unsigned long value = 0;
    const char *start = p;
    for (; digit_of((uint8_t)*p) < base; p++) value = value * (unsigned long)base + (unsigned long)digit_of((uint8_t)*p);
    if (end) *end = (char *)(p == start ? text : p);
    return negative ? -value : value;
}

long strtol(const char *text, char **end, int base) { return (long)strtoul(text, end, base); }
int atoi(const char *text) { return (int)strtol(text, NULL, 10); }

double atof(const char *text)
{
    while (isspace((uint8_t)*text)) text++;
    int negative = 0;
    if (*text == '-' || *text == '+') negative = *text++ == '-';
    double value = 0;
    for (; isdigit((uint8_t)*text); text++) value = value * 10 + (*text - '0');
    if (*text == '.') {
        double scale = 0.1;
        for (text++; isdigit((uint8_t)*text); text++, scale *= 0.1) value += (*text - '0') * scale;
    }
    return negative ? -value : value;
}

// A bump allocator: Doom takes its zone in one block at startup and little else afterwards, so only
// the newest block is ever given back.
typedef struct {
    size_t size;
    size_t pad;
} block_t;

extern char _end[];
static uint8_t *heap_next;
static uint8_t *heap_limit;

void guest_heap(uint8_t *limit)
{
    heap_next = (uint8_t *)(((uintptr_t)_end + 15) & ~(uintptr_t)15);
    heap_limit = limit;
}

void *malloc(size_t size)
{
    size = (size + 15) & ~(size_t)15;
    if (size > (size_t)(heap_limit - heap_next) - sizeof(block_t)) return NULL;
    block_t *block = (block_t *)heap_next;
    block->size = size;
    heap_next += sizeof(block_t) + size;
    return block + 1;
}

void free(void *memory)
{
    if (!memory) return;
    block_t *block = (block_t *)memory - 1;
    if ((uint8_t *)memory + block->size == heap_next) heap_next = (uint8_t *)block;
}

void *calloc(size_t count, size_t size)
{
    void *memory = malloc(count * size);
    if (memory) memset(memory, 0, count * size);
    return memory;
}

void *realloc(void *memory, size_t size)
{
    if (!memory) return malloc(size);
    block_t *block = (block_t *)memory - 1;
    if (size <= block->size) return memory;
    void *moved = malloc(size);
    if (moved) memcpy(moved, memory, block->size);
    return moved;
}

void exit(int code)
{
    host_call(HOST_EXIT, code, 0, 0, 0);
    for (;;) {}
}

void abort(void) { exit(134); }
int atexit(void (*handler)(void))
{
    (void)handler;
    return 0;
}
char *getenv(const char *name)
{
    (void)name;
    return NULL;
}
int system(const char *command)
{
    (void)command;
    return -1;
}

struct guest_file {
    int handle;
    long position;
    long size;
    int at_end;
};

static FILE console_out = {-1, 0, 0, 0};
static FILE console_err = {-2, 0, 0, 0};
FILE *stdin = NULL;
FILE *stdout = &console_out;
FILE *stderr = &console_err;

FILE *fopen(const char *path, const char *mode)
{
    if (mode[0] != 'r') return NULL;
    int handle = (int)host_call(HOST_OPEN, (long)path, 0, 0, 0);
    if (handle < 0) return NULL;
    FILE *file = malloc(sizeof(FILE));
    file->handle = handle;
    file->position = 0;
    file->size = host_call(HOST_SIZE, handle, 0, 0, 0);
    file->at_end = 0;
    return file;
}

int fclose(FILE *file)
{
    if (file && file->handle >= 0) free(file);
    return 0;
}

size_t fread(void *out, size_t size, size_t count, FILE *file)
{
    if (!file || file->handle < 0 || size == 0) return 0;
    long got = host_call(HOST_READ, file->handle, (long)out, (long)(size * count), file->position);
    file->position += got;
    if ((size_t)got < size * count) file->at_end = 1;
    return (size_t)got / size;
}

size_t fwrite(const void *data, size_t size, size_t count, FILE *file)
{
    if (!file || file->handle >= 0) return 0;
    host_call(HOST_WRITE, (long)data, (long)(size * count), 0, 0);
    return count;
}

int fseek(FILE *file, long offset, int whence)
{
    if (!file || file->handle < 0) return -1;
    file->position = whence == SEEK_SET ? offset : whence == SEEK_CUR ? file->position + offset : file->size + offset;
    file->at_end = 0;
    return 0;
}

long ftell(FILE *file) { return file ? file->position : -1; }
int fflush(FILE *file)
{
    (void)file;
    return 0;
}
int feof(FILE *file) { return !file || file->at_end || file->position >= file->size; }

char *fgets(char *out, int size, FILE *file)
{
    int n = 0;
    char c;
    while (n < size - 1 && fread(&c, 1, 1, file) == 1) {
        out[n++] = c;
        if (c == '\n') break;
    }
    out[n] = 0;
    return n ? out : NULL;
}

int remove(const char *path)
{
    (void)path;
    return -1;
}
int rename(const char *from, const char *to)
{
    (void)from;
    (void)to;
    return -1;
}
int mkdir(const char *path, mode_t mode)
{
    (void)path;
    (void)mode;
    return -1;
}

typedef struct {
    char *out;
    size_t size;
    size_t length;
} sink_t;

static void emit(sink_t *sink, char c)
{
    if (sink->length + 1 < sink->size) sink->out[sink->length] = c;
    sink->length++;
}

static void emit_number(sink_t *sink, unsigned long long value, unsigned base, int upper, int negative, int width,
                        int precision, int zero, int left)
{
    char digits[24];
    int n = 0;
    do {
        unsigned d = (unsigned)(value % base);
        digits[n++] = (char)(d < 10 ? '0' + d : (upper ? 'A' : 'a') + d - 10);
        value /= base;
    } while (value);
    int zeros = precision > n ? precision - n : 0;
    int pad = width - n - zeros - negative;
    if (zero && precision < 0 && !left) {
        zeros += pad > 0 ? pad : 0;
        pad = 0;
    }
    if (!left)
        while (pad-- > 0) emit(sink, ' ');
    if (negative) emit(sink, '-');
    while (zeros-- > 0) emit(sink, '0');
    while (n) emit(sink, digits[--n]);
    if (left)
        while (pad-- > 0) emit(sink, ' ');
}

int vsnprintf(char *out, size_t size, const char *format, va_list args)
{
    sink_t sink = {out, size, 0};
    for (; *format; format++) {
        if (*format != '%') {
            emit(&sink, *format);
            continue;
        }
        format++;
        int left = 0, zero = 0, width = 0, precision = -1, longs = 0;
        for (;; format++) {
            if (*format == '-') left = 1;
            else if (*format == '0') zero = 1;
            else if (*format != '+' && *format != ' ' && *format != '#') break;
        }
        if (*format == '*') {
            width = va_arg(args, int);
            format++;
        } else
            for (; isdigit((uint8_t)*format); format++) width = width * 10 + (*format - '0');
        if (*format == '.') {
            precision = 0;
            format++;
            if (*format == '*') {
                precision = va_arg(args, int);
                format++;
            } else
                for (; isdigit((uint8_t)*format); format++) precision = precision * 10 + (*format - '0');
        }
        for (; *format == 'l' || *format == 'h' || *format == 'z'; format++)
            if (*format == 'l') longs++;
        switch (*format) {
        case 'd':
        case 'i': {
            long long value = longs > 1 ? va_arg(args, long long) : va_arg(args, int);
            unsigned long long magnitude = value < 0 ? 0ull - (unsigned long long)value : (unsigned long long)value;
            emit_number(&sink, magnitude, 10, 0, value < 0, width, precision, zero, left);
            break;
        }
        case 'u':
        case 'x':
        case 'X':
        case 'o':
        case 'p': {
            unsigned long long value = longs > 1 ? va_arg(args, unsigned long long) : va_arg(args, unsigned);
            unsigned base = *format == 'u' ? 10 : *format == 'o' ? 8 : 16;
            emit_number(&sink, value, base, *format == 'X', 0, width, precision, zero, left);
            break;
        }
        case 'c':
            emit(&sink, (char)va_arg(args, int));
            break;
        case 's': {
            const char *text = va_arg(args, const char *);
            if (!text) text = "(null)";
            int n = (int)strlen(text);
            if (precision >= 0 && n > precision) n = precision;
            if (!left)
                for (int pad = width - n; pad > 0; pad--) emit(&sink, ' ');
            for (int i = 0; i < n; i++) emit(&sink, text[i]);
            if (left)
                for (int pad = width - n; pad > 0; pad--) emit(&sink, ' ');
            break;
        }
        case 'f':
        case 'g': {
            double value = va_arg(args, double);
            emit_number(&sink, (unsigned long long)(value < 0 ? -value : value), 10, 0, value < 0, width, -1, 0, left);
            break;
        }
        case 0:
            format--;
            break;
        default:
            emit(&sink, *format);
        }
    }
    if (size) out[sink.length < size ? sink.length : size - 1] = 0;
    return (int)sink.length;
}

int snprintf(char *out, size_t size, const char *format, ...)
{
    va_list args;
    va_start(args, format);
    int n = vsnprintf(out, size, format, args);
    va_end(args);
    return n;
}

int sprintf(char *out, const char *format, ...)
{
    va_list args;
    va_start(args, format);
    int n = vsnprintf(out, 0x7fffffff, format, args);
    va_end(args);
    return n;
}

int vprintf(const char *format, va_list args)
{
    char line[512];
    int n = vsnprintf(line, sizeof line, format, args);
    if (n > (int)sizeof line - 1) n = sizeof line - 1;
    host_call(HOST_WRITE, (long)line, n, 0, 0);
    return n;
}

int vfprintf(FILE *file, const char *format, va_list args)
{
    if (!file || file->handle >= 0) return 0;
    return vprintf(format, args);
}

int printf(const char *format, ...)
{
    va_list args;
    va_start(args, format);
    int n = vprintf(format, args);
    va_end(args);
    return n;
}

int fprintf(FILE *file, const char *format, ...)
{
    va_list args;
    va_start(args, format);
    int n = vfprintf(file, format, args);
    va_end(args);
    return n;
}

int puts(const char *text)
{
    host_call(HOST_WRITE, (long)text, (long)strlen(text), 0, 0);
    host_call(HOST_WRITE, (long)"\n", 1, 0, 0);
    return 0;
}

int putchar(int c)
{
    char byte = (char)c;
    host_call(HOST_WRITE, (long)&byte, 1, 0, 0);
    return c;
}

int fputs(const char *text, FILE *file) { return (int)fwrite(text, 1, strlen(text), file); }
int fputc(int c, FILE *file)
{
    char byte = (char)c;
    fwrite(&byte, 1, 1, file);
    return c;
}

// Whitespace, literals and %d %i %x %o: what Doom parses its numbers with.
int sscanf(const char *text, const char *format, ...)
{
    va_list args;
    va_start(args, format);
    int stored = 0;
    for (; *format; format++) {
        if (isspace((uint8_t)*format)) {
            while (isspace((uint8_t)*text)) text++;
        } else if (*format != '%') {
            if (*text++ != *format) break;
        } else {
            format++;
            int base = *format == 'x' ? 16 : *format == 'o' ? 8 : *format == 'i' ? 0 : 10;
            char *end;
            long value = strtol(text, &end, base);
            if (end == text) break;
            *va_arg(args, int *) = (int)value;
            text = end;
            stored++;
        }
    }
    va_end(args);
    return stored;
}

int fscanf(FILE *file, const char *format, ...)
{
    (void)file;
    (void)format;
    return EOF;
}
