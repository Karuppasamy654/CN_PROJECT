#ifndef NETCODE_NS3_SHA256_H
#define NETCODE_NS3_SHA256_H

#include <cstdint>
#include <cstddef>
#include <string>

namespace netcode {

typedef struct {
    uint32_t state[8];
    uint64_t count;
    uint8_t buffer[64];
} sha256_ctx;

void sha256_init(sha256_ctx *ctx);
void sha256_update(sha256_ctx *ctx, const uint8_t *data, size_t len);
void sha256_final(sha256_ctx *ctx, uint8_t hash[32]);

std::string sha256_file(const std::string &filepath);
std::string sha256_bytes(const uint8_t *data, size_t len);

} // namespace netcode

#endif // NETCODE_NS3_SHA256_H
