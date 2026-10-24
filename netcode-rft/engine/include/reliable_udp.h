#ifndef NETCODE_RELIABLE_UDP_H
#define NETCODE_RELIABLE_UDP_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "protocol.h"
#include "impairment.h"
#include "metrics.h"

#define RUDP_TIMEOUT_MS 150
#define RUDP_MAX_RETRIES 50

int rudp_send_file(int sock, const char *dest_ip, int dest_port,
                   const char *filepath, size_t block_size,
                   impairment_config_t *impair, netcode_metrics_t *metrics);

int rudp_receive_file(int sock, const char *out_filepath,
                      size_t original_file_size, size_t block_size,
                      impairment_config_t *impair, netcode_metrics_t *metrics);

#endif /* NETCODE_RELIABLE_UDP_H */
