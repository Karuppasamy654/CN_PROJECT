#include <stdio.h>
#include <assert.h>
#include <string.h>
#include "gf256.h"

int main() {
    printf("Running GF(256) Unit Tests...\n");
    gf256_init();

    /* 1. Addition / Subtraction (XOR) & Self-Addition */
    for (int i = 0; i < 256; i++) {
        assert(gf256_add((uint8_t)i, (uint8_t)i) == 0);
        assert(gf256_sub((uint8_t)i, (uint8_t)i) == 0);
        for (int j = 0; j < 256; j++) {
            assert(gf256_add((uint8_t)i, (uint8_t)j) == ((uint8_t)i ^ (uint8_t)j));
            assert(gf256_sub((uint8_t)i, (uint8_t)j) == ((uint8_t)i ^ (uint8_t)j));
        }
    }
    printf("  [GF256] Addition, Subtraction, and Self-Addition (256x256) verified.\n");

    /* 2. Multiplication against bitwise reference for all 256 x 256 input pairs */
    for (int a = 0; a < 256; a++) {
        for (int b = 0; b < 256; b++) {
            uint8_t prod_table = gf256_mul((uint8_t)a, (uint8_t)b);
            uint8_t prod_ref = gf256_mul_reference((uint8_t)a, (uint8_t)b);
            assert(prod_table == prod_ref);

            /* Commutativity */
            assert(prod_table == gf256_mul((uint8_t)b, (uint8_t)a));

            /* Zero property */
            if (a == 0 || b == 0) {
                assert(prod_table == 0);
            }
            /* Multiplicative Identity */
            if (a == 1) {
                assert(prod_table == (uint8_t)b);
            }
        }
    }
    printf("  [GF256] All 256x256 multiplication pairs verified against reference calculation.\n");

    /* 3. Inverses & Division */
    assert(gf256_inv(0) == 0);
    assert(gf256_div(0, 5) == 0);
    assert(gf256_div(5, 0) == 0);

    for (int i = 1; i < 256; i++) {
        uint8_t inv = gf256_inv((uint8_t)i);
        assert(inv != 0);
        uint8_t prod = gf256_mul((uint8_t)i, inv);
        assert(prod == 1);
        assert(gf256_div((uint8_t)i, (uint8_t)i) == 1);

        for (int j = 1; j < 256; j++) {
            uint8_t p = gf256_mul((uint8_t)i, (uint8_t)j);
            assert(gf256_div(p, (uint8_t)j) == (uint8_t)i);
        }
    }
    printf("  [GF256] All nonzero multiplicative inverses (a * inv(a) = 1) and division verified.\n");

    /* 4. Vector multiply-add */
    uint8_t row[4] = {1, 2, 3, 4};
    uint8_t src[4] = {10, 20, 30, 40};
    uint8_t coeff = 0x02;
    gf256_row_madd(row, src, 4, coeff);

    for (int i = 0; i < 4; i++) {
        uint8_t expected = gf256_add((uint8_t)(i + 1), gf256_mul(src[i], coeff));
        assert(row[i] == expected);
    }
    printf("  [GF256] Vector row multiply-add verified.\n");

    printf("ALL GF(256) UNIT TESTS PASSED!\n");
    return 0;
}
