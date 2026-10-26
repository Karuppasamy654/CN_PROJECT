#ifndef NETCODE_RLNC_H
#define NETCODE_RLNC_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "protocol.h"

typedef struct {
    uint8_t K;
    size_t block_size;
    uint8_t blocks[MAX_GENERATION_K][MAX_PAYLOAD_SIZE];
    size_t actual_lengths[MAX_GENERATION_K];
} rlnc_encoder_t;

typedef struct {
    uint8_t K;
    size_t block_size;
    uint8_t matrix[MAX_GENERATION_K][MAX_GENERATION_K + MAX_PAYLOAD_SIZE];
    bool has_row[MAX_GENERATION_K];
    int rank;
    uint32_t independent_count;
    uint32_t dependent_count;
} rlnc_decoder_t;

void rlnc_set_seed(uint32_t seed);
void rlnc_encoder_init(rlnc_encoder_t *enc, uint8_t K, size_t block_size);
void rlnc_encoder_set_block(rlnc_encoder_t *enc, uint8_t index, const uint8_t *data, size_t len);
void rlnc_encode_systematic(rlnc_encoder_t *enc, uint8_t index, uint8_t *coeffs_out, uint8_t *payload_out);
void rlnc_encode_random(rlnc_encoder_t *enc, uint8_t *coeffs_out, uint8_t *payload_out);

void rlnc_decoder_init(rlnc_decoder_t *dec, uint8_t K, size_t block_size);
bool rlnc_decoder_add_packet(rlnc_decoder_t *dec, const uint8_t *coeffs, const uint8_t *payload, uint16_t gen_id);
bool rlnc_decoder_is_complete(const rlnc_decoder_t *dec);
int rlnc_decoder_get_block(const rlnc_decoder_t *dec, uint8_t index, uint8_t *out_data, size_t *out_len);

#endif /* NETCODE_RLNC_H */
