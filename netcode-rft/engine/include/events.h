#ifndef NETCODE_EVENTS_H
#define NETCODE_EVENTS_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

void events_init(const char *transfer_id);

void event_emit_source_block_created(int block_id, size_t offset, size_t len, const uint8_t *data);
void event_emit_packet_transmitted(uint16_t seq_id, uint16_t gen_id, const char *type_str,
                                  int attempt,
                                  const uint8_t *coeffs, uint8_t K, size_t payload_len,
                                  const uint8_t *payload);
void event_emit_packet_dropped(uint16_t seq_id, uint16_t gen_id, int attempt, const char *reason);
void event_emit_packet_received(uint16_t seq_id, uint16_t gen_id, size_t payload_len,
                                const uint8_t *coeffs, uint8_t K,
                                const uint8_t *payload);
void event_emit_decoder_matrix_update(uint16_t gen_id, int current_rank, int required_rank,
                                      bool is_innovative);
void event_emit_decoder_step(uint16_t gen_id, const char *op_type, int pivot_row, int pivot_col,
                            uint8_t pivot_val, const char *description);
void event_emit_rudp_ack(uint16_t ack_seq, uint16_t expected_seq, int attempt, double rtt_ms);
void event_emit_rudp_ack_sent(uint16_t ack_seq);
void event_emit_rudp_timeout(uint16_t seq_id, int attempt, int timeout_ms);
void event_emit_rudp_retransmit(uint16_t seq_id, int retry_count, int attempt);
void event_emit_reconstruction_progress(size_t recovered_blocks, size_t total_blocks, int pct);
void event_emit_verification_result(bool passed, const char *orig_sha, const char *recon_sha,
                                   size_t orig_sz, size_t recon_sz);
void event_emit_handshake(int step, const char *step_name, const char *direction, const char *desc);

#endif /* NETCODE_EVENTS_H */
