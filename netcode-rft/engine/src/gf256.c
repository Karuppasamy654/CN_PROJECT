#include "gf256.h"
#include <stdbool.h>

static uint8_t gf_exp[512];
static uint8_t gf_log[256];
static bool gf_initialized = false;

uint8_t gf256_add(uint8_t a, uint8_t b) {
    return a ^ b;
}

uint8_t gf256_sub(uint8_t a, uint8_t b) {
    return a ^ b;
}

uint8_t gf256_mul_reference(uint8_t a, uint8_t b) {
    uint8_t res = 0;
    while (b > 0) {
        if (b & 1) {
            res ^= a;
        }
        uint8_t high_bit = a & 0x80;
        a <<= 1;
        if (high_bit) {
            a ^= (GF256_PRIMITIVE_POLY & 0xFF);
        }
        b >>= 1;
    }
    return res;
}

void gf256_init(void) {
    if (gf_initialized) return;

    uint32_t val = 1;
    for (int i = 0; i < 255; i++) {
        gf_exp[i] = (uint8_t)val;
        gf_exp[i + 255] = (uint8_t)val;
        gf_log[val] = (uint8_t)i;

        val <<= 1;
        if (val & 0x100) {
            val ^= GF256_PRIMITIVE_POLY;
        }
    }
    gf_log[0] = 0;
    gf_initialized = true;
}

uint8_t gf256_mul(uint8_t a, uint8_t b) {
    if (!gf_initialized) gf256_init();
    if (a == 0 || b == 0) return 0;
    return gf_exp[(uint16_t)gf_log[a] + gf_log[b]];
}

uint8_t gf256_inv(uint8_t a) {
    if (!gf_initialized) gf256_init();
    if (a == 0) return 0;
    return gf_exp[255 - gf_log[a]];
}

uint8_t gf256_div(uint8_t a, uint8_t b) {
    if (!gf_initialized) gf256_init();
    if (a == 0) return 0;
    if (b == 0) return 0;
    int log_diff = (int)gf_log[a] - (int)gf_log[b];
    if (log_diff < 0) log_diff += 255;
    return gf_exp[log_diff];
}

void gf256_row_mul(uint8_t *row, size_t len, uint8_t c) {
    if (!gf_initialized) gf256_init();
    if (c == 0) {
        for (size_t i = 0; i < len; i++) row[i] = 0;
        return;
    }
    if (c == 1) return;
    uint8_t log_c = gf_log[c];
    for (size_t i = 0; i < len; i++) {
        if (row[i] != 0) {
            row[i] = gf_exp[(uint16_t)gf_log[row[i]] + log_c];
        }
    }
}

void gf256_row_madd(uint8_t *dst, const uint8_t *src, size_t len, uint8_t c) {
    if (!gf_initialized) gf256_init();
    if (c == 0) return;
    uint8_t log_c = gf_log[c];
    for (size_t i = 0; i < len; i++) {
        if (src[i] != 0) {
            dst[i] ^= gf_exp[(uint16_t)gf_log[src[i]] + log_c];
        }
    }
}
