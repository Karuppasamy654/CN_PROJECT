#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#include "events.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <ctype.h>

static char g_transfer_id[64] = "default";

static double get_timestamp_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

void events_init(const char *transfer_id) {
    if (transfer_id) {
        strncpy(g_transfer_id, transfer_id, sizeof(g_transfer_id) - 1);
        g_transfer_id[sizeof(g_transfer_id) - 1] = '\0';
    }
}

void event_emit_source_block_created(int block_id, size_t offset, size_t len, const uint8_t *data) {
    char hex_str[33] = {0};
    char ascii_str[17] = {0};
    size_t preview_len = len < 16 ? len : 16;
    for (size_t i = 0; i < preview_len; i++) {
        sprintf(hex_str + (i * 2), "%02x", data[i]);
        char c = (char)data[i];
        if (c == '"' || c == '\\') {
            ascii_str[i] = '.';
        } else {
            ascii_str[i] = (isprint((unsigned char)c)) ? c : '.';
        }
    }
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"source_block_created\",\"time\":%.2f,"
           "\"block_id\":%d,\"offset\":%zu,\"len\":%zu,\"hex_preview\":\"%s\",\"ascii_preview\":\"%s\"}\n",
           g_transfer_id, get_timestamp_ms(), block_id, offset, len, hex_str, ascii_str);
    fflush(stdout);
}

void event_emit_packet_transmitted(uint16_t seq_id, uint16_t gen_id, const char *type_str,
                                  const uint8_t *coeffs, uint8_t K, size_t payload_len,
                                  const uint8_t *payload) {
    char coeff_json[256] = "[";
    if (coeffs && K > 0) {
        for (int i = 0; i < K; i++) {
            char num[16];
            snprintf(num, sizeof(num), "%u%s", coeffs[i], (i < K - 1) ? "," : "");
            strncat(coeff_json, num, sizeof(coeff_json) - strlen(coeff_json) - 1);
        }
    }
    strncat(coeff_json, "]", sizeof(coeff_json) - strlen(coeff_json) - 1);

    char data_json[256] = "[";
    if (payload && payload_len > 0) {
        size_t prev_len = payload_len < 6 ? payload_len : 6;
        for (size_t i = 0; i < prev_len; i++) {
            char num[16];
            snprintf(num, sizeof(num), "%u%s", payload[i], (i < prev_len - 1) ? "," : "");
            strncat(data_json, num, sizeof(data_json) - strlen(data_json) - 1);
        }
    }
    strncat(data_json, "]", sizeof(data_json) - strlen(data_json) - 1);

    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"packet_transmitted\",\"time\":%.2f,"
           "\"seq_id\":%u,\"gen_id\":%u,\"pkt_type\":\"%s\",\"coeffs\":%s,\"payload_len\":%zu,\"data_preview\":%s}\n",
           g_transfer_id, get_timestamp_ms(), seq_id, gen_id, type_str, coeff_json, payload_len, data_json);
    fflush(stdout);
}

void event_emit_packet_dropped(uint16_t seq_id, uint16_t gen_id, const char *reason) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"packet_dropped\",\"time\":%.2f,"
           "\"seq_id\":%u,\"gen_id\":%u,\"reason\":\"%s\"}\n",
           g_transfer_id, get_timestamp_ms(), seq_id, gen_id, reason);
    fflush(stdout);
}

void event_emit_packet_received(uint16_t seq_id, uint16_t gen_id, size_t payload_len,
                                const uint8_t *coeffs, uint8_t K,
                                const uint8_t *payload) {
    char coeff_json[256] = "[";
    if (coeffs && K > 0) {
        for (int i = 0; i < K; i++) {
            char num[16];
            snprintf(num, sizeof(num), "%u%s", coeffs[i], (i < K - 1) ? "," : "");
            strncat(coeff_json, num, sizeof(coeff_json) - strlen(coeff_json) - 1);
        }
    }
    strncat(coeff_json, "]", sizeof(coeff_json) - strlen(coeff_json) - 1);

    char data_json[256] = "[";
    if (payload && payload_len > 0) {
        size_t prev_len = payload_len < 6 ? payload_len : 6;
        for (size_t i = 0; i < prev_len; i++) {
            char num[16];
            snprintf(num, sizeof(num), "%u%s", payload[i], (i < prev_len - 1) ? "," : "");
            strncat(data_json, num, sizeof(data_json) - strlen(data_json) - 1);
        }
    }
    strncat(data_json, "]", sizeof(data_json) - strlen(data_json) - 1);

    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"packet_received\",\"time\":%.2f,"
           "\"seq_id\":%u,\"gen_id\":%u,\"payload_len\":%zu,\"coeffs\":%s,\"data_preview\":%s}\n",
           g_transfer_id, get_timestamp_ms(), seq_id, gen_id, payload_len, coeff_json, data_json);
    fflush(stdout);
}

void event_emit_decoder_matrix_update(uint16_t gen_id, int current_rank, int required_rank,
                                      bool is_innovative) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"decoder_matrix_update\",\"time\":%.2f,"
           "\"gen_id\":%u,\"rank\":%d,\"required_rank\":%d,\"innovative\":%s}\n",
           g_transfer_id, get_timestamp_ms(), gen_id, current_rank, required_rank,
           is_innovative ? "true" : "false");
    fflush(stdout);
}

void event_emit_decoder_step(uint16_t gen_id, const char *op_type, int pivot_row, int pivot_col,
                            uint8_t pivot_val, const char *description) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"decoder_step\",\"time\":%.2f,"
           "\"gen_id\":%u,\"op\":\"%s\",\"pivot_row\":%d,\"pivot_col\":%d,\"pivot_val\":%u,"
           "\"desc\":\"%s\"}\n",
           g_transfer_id, get_timestamp_ms(), gen_id, op_type, pivot_row, pivot_col, pivot_val, description);
    fflush(stdout);
}

void event_emit_rudp_ack(uint16_t ack_seq, uint16_t expected_seq) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"rudp_ack\",\"time\":%.2f,"
           "\"ack_seq\":%u,\"expected_seq\":%u}\n",
           g_transfer_id, get_timestamp_ms(), ack_seq, expected_seq);
    fflush(stdout);
}

void event_emit_rudp_retransmit(uint16_t seq_id, int retry_count) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"rudp_retransmit\",\"time\":%.2f,"
           "\"seq_id\":%u,\"retry_count\":%d}\n",
           g_transfer_id, get_timestamp_ms(), seq_id, retry_count);
    fflush(stdout);
}

void event_emit_reconstruction_progress(size_t recovered_blocks, size_t total_blocks, int pct) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"reconstruction_progress\",\"time\":%.2f,"
           "\"recovered_blocks\":%zu,\"total_blocks\":%zu,\"pct\":%d}\n",
           g_transfer_id, get_timestamp_ms(), recovered_blocks, total_blocks, pct);
    fflush(stdout);
}

void event_emit_verification_result(bool passed, const char *orig_sha, const char *recon_sha,
                                   size_t orig_sz, size_t recon_sz) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"verification_result\",\"time\":%.2f,"
           "\"passed\":%s,\"orig_sha\":\"%s\",\"recon_sha\":\"%s\",\"orig_sz\":%zu,\"recon_sz\":%zu}\n",
           g_transfer_id, get_timestamp_ms(), passed ? "true" : "false", orig_sha, recon_sha,
           orig_sz, recon_sz);
    fflush(stdout);
}

void event_emit_handshake(int step, const char *step_name, const char *direction, const char *desc) {
    printf("EVENT_JSON:{\"transfer_id\":\"%s\",\"type\":\"handshake_step\",\"time\":%.2f,"
           "\"step\":%d,\"step_name\":\"%s\",\"direction\":\"%s\",\"desc\":\"%s\"}\n",
           g_transfer_id, get_timestamp_ms(), step, step_name, direction, desc);
    fflush(stdout);
}
