#ifndef NETCODE_SHA256_H
#define NETCODE_SHA256_H

#include <stdint.h>
#include <stddef.h>

typedef struct {
    uint32_t state[8];
    uint64_t count;
    uint8_t buffer[64];
} sha256_ctx;

void sha256_init(sha256_ctx *ctx);
void sha256_update(sha256_ctx *ctx, const uint8_t *data, size_t len);
void sha256_final(sha256_ctx *ctx, uint8_t hash[32]);

void sha256_buffer(const uint8_t *data, size_t len, char hex_output[65]);
int sha256_file(const char *filepath, char hex_output[65]);

#endif /* NETCODE_SHA256_H */
