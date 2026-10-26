#include "gf256.h"
#include <cstring>

namespace netcode {

static uint8_t s_gf256_exp[512];
static uint8_t s_gf256_log[256];
static uint8_t s_gf256_inv[256];
static uint8_t s_gf256_mul_table[256][256];
static bool s_initialized = false;

void gf256_init() {
    if (s_initialized) return;

    uint32_t val = 1;
    for (int i = 0; i < 255; i++) {
        s_gf256_exp[i] = (uint8_t)val;
        s_gf256_log[val] = (uint8_t)i;

        val <<= 1;
        if (val & 0x100) {
            val ^= GF256_PRIMITIVE_POLY;
        }
    }

    for (int i = 255; i < 512; i++) {
        s_gf256_exp[i] = s_gf256_exp[i - 255];
    }

    s_gf256_log[0] = 0;
    s_gf256_inv[0] = 0;

    for (int i = 1; i < 256; i++) {
        int log_i = s_gf256_log[i];
        int inv_log = 255 - log_i;
        s_gf256_inv[i] = s_gf256_exp[inv_log];
    }

    for (int a = 0; a < 256; a++) {
        for (int b = 0; b < 256; b++) {
            if (a == 0 || b == 0) {
                s_gf256_mul_table[a][b] = 0;
            } else {
                int sum = (int)s_gf256_log[a] + (int)s_gf256_log[b];
                s_gf256_mul_table[a][b] = s_gf256_exp[sum];
            }
        }
    }

    s_initialized = true;
}

uint8_t gf256_add(uint8_t a, uint8_t b) {
    return (uint8_t)(a ^ b);
}

uint8_t gf256_sub(uint8_t a, uint8_t b) {
    return (uint8_t)(a ^ b);
}

uint8_t gf256_mul(uint8_t a, uint8_t b) {
    if (!s_initialized) gf256_init();
    return s_gf256_mul_table[a][b];
}

uint8_t gf256_inv(uint8_t a) {
    if (!s_initialized) gf256_init();
    return s_gf256_inv[a];
}

uint8_t gf256_div(uint8_t a, uint8_t b) {
    if (b == 0) return 0;
    if (a == 0) return 0;
    if (!s_initialized) gf256_init();
    return s_gf256_mul_table[a][s_gf256_inv[b]];
}

void gf256_row_mul(uint8_t *row, size_t len, uint8_t c) {
    if (!s_initialized) gf256_init();
    if (c == 0) {
        std::memset(row, 0, len);
        return;
    }
    if (c == 1) return;
    for (size_t i = 0; i < len; i++) {
        row[i] = s_gf256_mul_table[row[i]][c];
    }
}

void gf256_row_madd(uint8_t *dst, const uint8_t *src, size_t len, uint8_t c) {
    if (!s_initialized) gf256_init();
    if (c == 0) return;
    for (size_t i = 0; i < len; i++) {
        dst[i] ^= s_gf256_mul_table[src[i]][c];
    }
}

uint8_t gf256_mul_reference(uint8_t a, uint8_t b) {
    uint8_t p = 0;
    uint8_t hi_bit_set;
    for (int i = 0; i < 8; i++) {
        if (b & 1) {
            p ^= a;
        }
        hi_bit_set = (uint8_t)(a & 0x80);
        a <<= 1;
        if (hi_bit_set) {
            a ^= (uint8_t)(GF256_PRIMITIVE_POLY & 0xFF);
        }
        b >>= 1;
    }
    return p;
}

} // namespace netcode
