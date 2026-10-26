#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdbool.h>
#include "sha256.h"

static void compute_buf_sha256(const uint8_t *data, size_t len, char *hex_out) {
    sha256_ctx ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, data, len);
    uint8_t hash[32];
    sha256_final(&ctx, hash);
    for (int i = 0; i < 32; i++) {
        sprintf(hex_out + (i * 2), "%02x", hash[i]);
    }
    hex_out[64] = '\0';
}

int main(void) {
    printf("Running File Integrity, SHA-256 & Corruption Detection Unit Tests...\n");

    /* 1. Empty buffer (0-byte file NIST test vector) */
    char empty_hex[65];
    compute_buf_sha256(NULL, 0, empty_hex);
    assert(strcmp(empty_hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") == 0);
    printf("  [Integrity] 0-Byte empty file NIST SHA-256 standard verified:\n      %s\n", empty_hex);

    /* 2. 1-Byte file */
    uint8_t one_byte = 'A';
    char one_hex[65];
    compute_buf_sha256(&one_byte, 1, one_hex);
    /* SHA-256("A") = 559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd */
    assert(strcmp(one_hex, "559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd") == 0);
    printf("  [Integrity] 1-Byte file NIST SHA-256 verified:\n      %s\n", one_hex);

    /* 3. Multi-block buffer (4096 bytes) */
    uint8_t buf_orig[4096];
    uint8_t buf_recon[4096];
    for (int i = 0; i < 4096; i++) {
        buf_orig[i] = (uint8_t)((i * 37 + 13) & 0xFF);
        buf_recon[i] = buf_orig[i];
    }
    char hash_orig[65], hash_recon[65];
    compute_buf_sha256(buf_orig, 4096, hash_orig);
    compute_buf_sha256(buf_recon, 4096, hash_recon);
    assert(strcmp(hash_orig, hash_recon) == 0);
    assert(memcmp(buf_orig, buf_recon, 4096) == 0);
    printf("  [Integrity] 4096-Byte multi-block bit-exact equality verified.\n");

    /* 4. Single-byte corruption detection */
    buf_recon[2048] ^= 0x01; /* Flip lowest bit in byte 2048 */
    char hash_corrupt[65];
    compute_buf_sha256(buf_recon, 4096, hash_corrupt);
    assert(strcmp(hash_orig, hash_corrupt) != 0);
    assert(memcmp(buf_orig, buf_recon, 4096) != 0);
    printf("  [Integrity] Single-bit corruption detection verified:\n      Original:  %s\n      Corrupted: %s\n",
           hash_orig, hash_corrupt);

    /* 5. Truncation detection */
    char hash_trunc[65];
    compute_buf_sha256(buf_orig, 4095, hash_trunc);
    assert(strcmp(hash_orig, hash_trunc) != 0);
    printf("  [Integrity] Truncation (4095 vs 4096 bytes) size & hash mismatch verified.\n");

    printf("ALL FILE INTEGRITY & CRYPTOGRAPHIC VERIFICATION TESTS PASSED!\n");
    return 0;
}
