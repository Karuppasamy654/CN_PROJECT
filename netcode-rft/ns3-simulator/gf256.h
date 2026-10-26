#ifndef NETCODE_NS3_GF256_H
#define NETCODE_NS3_GF256_H

#include <cstdint>
#include <cstddef>

namespace netcode {

#define GF256_PRIMITIVE_POLY 0x11D
#define GF256_GENERATOR      0x02

void gf256_init();

uint8_t gf256_add(uint8_t a, uint8_t b);
uint8_t gf256_sub(uint8_t a, uint8_t b);
uint8_t gf256_mul(uint8_t a, uint8_t b);
uint8_t gf256_inv(uint8_t a);
uint8_t gf256_div(uint8_t a, uint8_t b);

/* Multiply row by scalar c: row[i] = c * row[i] */
void gf256_row_mul(uint8_t *row, size_t len, uint8_t c);

/* Multiply-add row: dst[i] ^= c * src[i] */
void gf256_row_madd(uint8_t *dst, const uint8_t *src, size_t len, uint8_t c);

/* Reference multiplication (Russian Peasant) */
uint8_t gf256_mul_reference(uint8_t a, uint8_t b);

} // namespace netcode

#endif // NETCODE_NS3_GF256_H
