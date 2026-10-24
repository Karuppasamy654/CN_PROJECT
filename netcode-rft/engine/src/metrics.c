#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#include "metrics.h"
#include <stdio.h>
#include <string.h>
#include <time.h>

static double get_time_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

void metrics_init(netcode_metrics_t *m, const char *transfer_id, const char *mode,
                  double loss_rate, uint32_t delay_ms, size_t file_size, size_t block_size, uint8_t K) {
    memset(m, 0, sizeof(*m));
    if (transfer_id) strncpy(m->transfer_id, transfer_id, sizeof(m->transfer_id) - 1);
    if (mode) strncpy(m->mode, mode, sizeof(m->mode) - 1);
    m->loss_rate = loss_rate;
    m->delay_ms = delay_ms;
    m->file_size = file_size;
    m->block_size = block_size;
    m->K = K;
}

void metrics_start(netcode_metrics_t *m) {
    m->start_time_ms = get_time_ms();
}

void metrics_stop(netcode_metrics_t *m) {
    m->end_time_ms = get_time_ms();
    m->duration_s = (m->end_time_ms - m->start_time_ms) / 1000.0;
    if (m->duration_s < 0.001) m->duration_s = 0.001;

    size_t total_tx_bytes = (size_t)m->packets_sent * (m->block_size + 16 + m->K);
    m->throughput_mbps = ((double)total_tx_bytes * 8.0) / (m->duration_s * 1000000.0);
    m->goodput_mbps = ((double)m->file_size * 8.0) / (m->duration_s * 1000000.0);
}

void metrics_emit(const netcode_metrics_t *m) {
    printf("METRICS_JSON:{\"transfer_id\":\"%s\",\"mode\":\"%s\",\"loss_rate\":%.2f,\"delay_ms\":%u,"
           "\"file_size\":%zu,\"block_size\":%zu,\"K\":%u,\"packets_sent\":%u,\"packets_received\":%u,"
           "\"packets_dropped\":%u,\"retransmissions\":%u,\"coded_packets\":%u,\"independent_packets\":%u,"
           "\"dependent_packets\":%u,\"duration_s\":%.3f,\"throughput_mbps\":%.3f,\"goodput_mbps\":%.3f}\n",
           m->transfer_id, m->mode, m->loss_rate, m->delay_ms, m->file_size, m->block_size, m->K,
           m->packets_sent, m->packets_received, m->packets_dropped, m->retransmissions,
           m->coded_packets, m->independent_packets, m->dependent_packets,
           m->duration_s, m->throughput_mbps, m->goodput_mbps);
    fflush(stdout);
}
