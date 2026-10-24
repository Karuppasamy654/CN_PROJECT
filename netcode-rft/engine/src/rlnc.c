#include "rlnc.h"
#include "gf256.h"
#include "events.h"
#include <string.h>
#include <stdlib.h>

void rlnc_encoder_init(rlnc_encoder_t *enc, uint8_t K, size_t block_size) {
    enc->K = K;
    enc->block_size = block_size;
    memset(enc->blocks, 0, sizeof(enc->blocks));
    memset(enc->actual_lengths, 0, sizeof(enc->actual_lengths));
}

void rlnc_encoder_set_block(rlnc_encoder_t *enc, uint8_t index, const uint8_t *data, size_t len) {
    if (index >= enc->K) return;
    size_t copy_len = len < enc->block_size ? len : enc->block_size;
    memcpy(enc->blocks[index], data, copy_len);
    if (copy_len < enc->block_size) {
        memset(enc->blocks[index] + copy_len, 0, enc->block_size - copy_len);
    }
    enc->actual_lengths[index] = len;
}

void rlnc_encode_systematic(rlnc_encoder_t *enc, uint8_t index, uint8_t *coeffs_out, uint8_t *payload_out) {
    memset(coeffs_out, 0, enc->K);
    if (index < enc->K) {
        coeffs_out[index] = 1;
        memcpy(payload_out, enc->blocks[index], enc->block_size);
    }
}

void rlnc_encode_random(rlnc_encoder_t *enc, uint8_t *coeffs_out, uint8_t *payload_out) {
    gf256_init();
    memset(payload_out, 0, enc->block_size);

    bool all_zero = true;
    for (uint8_t i = 0; i < enc->K; i++) {
        coeffs_out[i] = (uint8_t)(rand() % 256);
        if (coeffs_out[i] != 0) all_zero = false;
    }
    if (all_zero) coeffs_out[0] = 1;

    for (uint8_t i = 0; i < enc->K; i++) {
        if (coeffs_out[i] != 0) {
            gf256_row_madd(payload_out, enc->blocks[i], enc->block_size, coeffs_out[i]);
        }
    }
}

void rlnc_decoder_init(rlnc_decoder_t *dec, uint8_t K, size_t block_size) {
    gf256_init();
    dec->K = K;
    dec->block_size = block_size;
    memset(dec->matrix, 0, sizeof(dec->matrix));
    memset(dec->has_row, 0, sizeof(dec->has_row));
    dec->rank = 0;
    dec->independent_count = 0;
    dec->dependent_count = 0;
}

bool rlnc_decoder_add_packet(rlnc_decoder_t *dec, const uint8_t *coeffs, const uint8_t *payload, uint16_t gen_id) {
    if (dec->rank >= dec->K) {
        dec->dependent_count++;
        return false;
    }

    size_t total_cols = dec->K + dec->block_size;
    uint8_t row[MAX_GENERATION_K + MAX_PAYLOAD_SIZE];
    memset(row, 0, total_cols);
    memcpy(row, coeffs, dec->K);
    memcpy(row + dec->K, payload, dec->block_size);

    /* Forward elimination using existing pivot rows */
    for (int col = 0; col < dec->K; col++) {
        if (row[col] == 0) continue;

        if (dec->has_row[col]) {
            uint8_t factor = row[col];
            gf256_row_madd(row, dec->matrix[col], total_cols, factor);
        } else {
            /* Found innovative pivot */
            uint8_t pivot_val = row[col];
            uint8_t inv = gf256_inv(pivot_val);

            /* Normalize new pivot row */
            gf256_row_mul(row, total_cols, inv);
            memcpy(dec->matrix[col], row, total_cols);
            dec->has_row[col] = true;
            dec->rank++;
            dec->independent_count++;

            event_emit_decoder_step(gen_id, "pivot_normalize", col, col, pivot_val,
                                   "Normalized pivot row to unit leading coefficient");

            /* Eliminate all other existing pivot columns from this new pivot row */
            for (int c2 = 0; c2 < dec->K; c2++) {
                if (c2 != col && dec->has_row[c2] && dec->matrix[col][c2] != 0) {
                    uint8_t factor = dec->matrix[col][c2];
                    gf256_row_madd(dec->matrix[col], dec->matrix[c2], total_cols, factor);
                }
            }

            /* Back-substitute to eliminate this column from all other existing rows */
            for (int r = 0; r < dec->K; r++) {
                if (r != col && dec->has_row[r] && dec->matrix[r][col] != 0) {
                    uint8_t elim_factor = dec->matrix[r][col];
                    gf256_row_madd(dec->matrix[r], dec->matrix[col], total_cols, elim_factor);
                    event_emit_decoder_step(gen_id, "row_eliminate", r, col, elim_factor,
                                           "Eliminated column from existing row");
                }
            }

            event_emit_decoder_matrix_update(gen_id, dec->rank, dec->K, true);
            return true;
        }
    }

    dec->dependent_count++;
    event_emit_decoder_matrix_update(gen_id, dec->rank, dec->K, false);
    return false;
}

bool rlnc_decoder_is_complete(const rlnc_decoder_t *dec) {
    return dec->rank == dec->K;
}

int rlnc_decoder_get_block(const rlnc_decoder_t *dec, uint8_t index, uint8_t *out_data, size_t *out_len) {
    if (!rlnc_decoder_is_complete(dec) || index >= dec->K) {
        return -1;
    }
    memcpy(out_data, dec->matrix[index] + dec->K, dec->block_size);
    if (out_len) *out_len = dec->block_size;
    return 0;
}
