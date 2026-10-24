#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdlib.h>
#include "gf256.h"
#include "rlnc.h"

int main() {
    printf("Running Deterministic RLNC Encoding/Decoding Unit Tests...\n");
    gf256_init();

    uint8_t K = 4;
    size_t block_sz = 64;

    rlnc_encoder_t enc;
    rlnc_encoder_init(&enc, K, block_sz);

    /* 4 source blocks with distinct, known byte values */
    uint8_t original_data[4][64];
    for (int b = 0; b < 4; b++) {
        for (int i = 0; i < 64; i++) {
            original_data[b][i] = (uint8_t)((b * 53 + i * 17 + 7) & 0xFF);
        }
        rlnc_encoder_set_block(&enc, (uint8_t)b, original_data[b], 64);
    }

    /* Verify Systematic packets match source blocks byte-for-byte */
    for (uint8_t b = 0; b < K; b++) {
        uint8_t coeffs[4];
        uint8_t payload[64];
        rlnc_encode_systematic(&enc, b, coeffs, payload);
        for (uint8_t c = 0; c < K; c++) {
            assert(coeffs[c] == (c == b ? 1 : 0));
        }
        assert(memcmp(payload, original_data[b], block_sz) == 0);
    }
    printf("  [RLNC] All systematic packets and unit vectors verified.\n");

    /* Deterministic Coded Packet: c = [2, 3, 5, 7] */
    uint8_t det_c[4] = {2, 3, 5, 7};
    uint8_t det_p[64];
    memset(det_p, 0, sizeof(det_p));
    for (int b = 0; b < 4; b++) {
        gf256_row_madd(det_p, original_data[b], 64, det_c[b]);
    }

    /* Verify manual byte-for-byte GF(256) calculation */
    for (int i = 0; i < 64; i++) {
        uint8_t expected = gf256_mul(det_c[0], original_data[0][i]) ^
                           gf256_mul(det_c[1], original_data[1][i]) ^
                           gf256_mul(det_c[2], original_data[2][i]) ^
                           gf256_mul(det_c[3], original_data[3][i]);
        assert(det_p[i] == expected);
    }
    printf("  [RLNC] Deterministic GF(256) linear combination verified byte-for-byte.\n");

    /* Decoder verification */
    rlnc_decoder_t dec;
    rlnc_decoder_init(&dec, K, block_sz);

    /* Add systematic block 0 */
    uint8_t c0[4], p0[64];
    rlnc_encode_systematic(&enc, 0, c0, p0);
    bool inno0 = rlnc_decoder_add_packet(&dec, c0, p0, 0);
    assert(inno0 == true);
    assert(dec.rank == 1);
    assert(!rlnc_decoder_is_complete(&dec));

    /* Add duplicate systematic block 0: MUST be recognized as dependent */
    bool inno_dup = rlnc_decoder_add_packet(&dec, c0, p0, 0);
    assert(inno_dup == false);
    assert(dec.rank == 1);
    assert(dec.dependent_count == 1);

    /* Add scaled duplicate (2 * c0, 2 * p0): MUST also be dependent */
    uint8_t c_scaled[4], p_scaled[64];
    for (int i = 0; i < 4; i++) c_scaled[i] = gf256_mul(c0[i], 0x42);
    for (int i = 0; i < 64; i++) p_scaled[i] = gf256_mul(p0[i], 0x42);
    bool inno_scaled = rlnc_decoder_add_packet(&dec, c_scaled, p_scaled, 0);
    assert(inno_scaled == false);
    assert(dec.rank == 1);

    /* Cannot retrieve blocks before rank == K */
    uint8_t premature_blk[64];
    size_t out_len = 0;
    assert(rlnc_decoder_get_block(&dec, 0, premature_blk, &out_len) == -1);

    /* Add innovative deterministic packet */
    bool inno_det = rlnc_decoder_add_packet(&dec, det_c, det_p, 0);
    assert(inno_det == true);
    assert(dec.rank == 2);

    /* Add random innovative packets until rank 4 */
    int attempts = 0;
    while (!rlnc_decoder_is_complete(&dec) && attempts < 50) {
        uint8_t c[4], p[64];
        rlnc_encode_random(&enc, c, p);
        rlnc_decoder_add_packet(&dec, c, p, 0);
        attempts++;
    }

    assert(rlnc_decoder_is_complete(&dec) == true);
    assert(dec.rank == 4);

    /* Verify all reconstructed source blocks match originals byte-for-byte */
    for (int b = 0; b < 4; b++) {
        uint8_t out_blk[64];
        size_t len = 0;
        int res = rlnc_decoder_get_block(&dec, (uint8_t)b, out_blk, &len);
        assert(res == 0);
        assert(len == 64);
        assert(memcmp(original_data[b], out_blk, 64) == 0);
    }
    printf("  [RLNC] Full Gaussian elimination decoding verified byte-for-byte for all K blocks.\n");

    /* Test partial final block padding */
    rlnc_encoder_t enc_partial;
    rlnc_encoder_init(&enc_partial, 2, 64);
    uint8_t partial_data[23];
    memset(partial_data, 0xAB, sizeof(partial_data));
    rlnc_encoder_set_block(&enc_partial, 0, partial_data, 23);
    assert(enc_partial.blocks[0][22] == 0xAB);
    assert(enc_partial.blocks[0][23] == 0x00); /* Zero padded */
    printf("  [RLNC] Partial block zero-padding verified.\n");

    printf("ALL RLNC UNIT TESTS PASSED!\n");
    return 0;
}
