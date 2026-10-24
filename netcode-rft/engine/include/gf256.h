#ifndef NETCODE_GF256_H
#define NETCODE_GF256_H

#include <stdint.h>
#include <stddef.h>

/*
 * GF(256) Finite Field Arithmetic
 * Irreducible primitive polynomial: P(x) = x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
 * Primitive generator: g = 0x02
 */

#define GF256_PRIMITIVE_POLY 0x11D
#define GF256_GENERATOR      0x02

void gf256_init(void);

uint8_t gf256_add(uint8_t a, uint8_t b);
uint8_t gf256_sub(uint8_t a, uint8_t b);
uint8_t gf256_mul(uint8_t a, uint8_t b);
uint8_t gf256_inv(uint8_t a);
uint8_t gf256_div(uint8_t a, uint8_t b);

/* Multiply row by scalar c: row[i] = c * row[i] */
void gf256_row_mul(uint8_t *row, size_t len, uint8_t c);

/* Multiply-add row: dst[i] ^= c * src[i] */
void gf256_row_madd(uint8_t *dst, const uint8_t *src, size_t len, uint8_t c);

/* Russian Peasant bitwise multiplication reference for verification */
uint8_t gf256_mul_reference(uint8_t a, uint8_t b);

#endif /* NETCODE_GF256_H */
