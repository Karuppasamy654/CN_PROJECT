#ifndef NETCODE_TRANSFER_H
#define NETCODE_TRANSFER_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "protocol.h"
#include "impairment.h"
#include "metrics.h"
#include "rlnc.h"

#define MAX_SUPPORTED_GENS 128

typedef struct {
    uint16_t gen_id;
    uint8_t current_rank;
    uint8_t needed;
} rlnc_feedback_t;

int rlnc_send_file(int sock, const char *dest_ip, int dest_port,
                   const char *filepath, size_t block_size, uint8_t K,
                   uint8_t redundancy, impairment_config_t *impair,
                   netcode_metrics_t *metrics);

int rlnc_receive_file(int sock, const char *out_filepath,
                      size_t block_size, uint8_t K, size_t original_file_size,
                      impairment_config_t *impair, netcode_metrics_t *metrics);

#endif /* NETCODE_TRANSFER_H */
