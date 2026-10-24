#ifndef NETCODE_METRICS_H
#define NETCODE_METRICS_H

#include <stdint.h>
#include <stddef.h>

typedef struct {
    char transfer_id[64];
    char mode[16];
    double loss_rate;
    uint32_t delay_ms;
    size_t file_size;
    size_t block_size;
    uint8_t K;

    uint32_t packets_sent;
    uint32_t packets_received;
    uint32_t packets_dropped;
    uint32_t retransmissions;
    uint32_t coded_packets;
    uint32_t independent_packets;
    uint32_t dependent_packets;

    double start_time_ms;
    double end_time_ms;
    double duration_s;
    double throughput_mbps;
    double goodput_mbps;
} netcode_metrics_t;

void metrics_init(netcode_metrics_t *m, const char *transfer_id, const char *mode,
                  double loss_rate, uint32_t delay_ms, size_t file_size, size_t block_size, uint8_t K);
void metrics_start(netcode_metrics_t *m);
void metrics_stop(netcode_metrics_t *m);
void metrics_emit(const netcode_metrics_t *m);

#endif /* NETCODE_METRICS_H */
