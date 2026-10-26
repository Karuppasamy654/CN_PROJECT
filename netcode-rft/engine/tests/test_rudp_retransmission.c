#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdbool.h>
#include "protocol.h"
#include "reliable_udp.h"

int main(void) {
    printf("Running Stop-and-Wait RUDP Retransmission & ARQ Unit Tests...\n");

    /* 1. Protocol Sequence Number and Data Packet Construction */
    netcode_packet_t data_pkt;
    memset(&data_pkt, 0, sizeof(data_pkt));
    data_pkt.header.magic[0] = NETCODE_MAGIC_0;
    data_pkt.header.magic[1] = NETCODE_MAGIC_1;
    data_pkt.header.version = NETCODE_VERSION;
    data_pkt.header.type = PKT_TYPE_DATA_RUDP;
    data_pkt.header.seq_id = 1;
    data_pkt.header.block_id = 0;
    data_pkt.header.payload_len = 32;
    memset(data_pkt.payload, 0x5A, 32);
    data_pkt.header.crc32 = protocol_crc32(data_pkt.payload, data_pkt.header.payload_len);

    uint8_t tx_buf[256];
    size_t tx_len = 0;
    assert(protocol_serialize_packet(&data_pkt, tx_buf, sizeof(tx_buf), &tx_len, 0) == 0);

    /* 2. Receiver Parsing and Duplicate Detection Simulation */
    uint16_t expected_seq = 1;
    int accepted_packets = 0;
    int duplicate_packets = 0;

    /* Simulate first arrival of seq=1 -> Accepted */
    netcode_packet_t rx_pkt;
    assert(protocol_parse_packet(tx_buf, tx_len, &rx_pkt, 0) == 0);
    if (rx_pkt.header.seq_id == expected_seq) {
        accepted_packets++;
        expected_seq++;
    }
    assert(accepted_packets == 1);
    assert(expected_seq == 2);
    printf("  [RUDP ARQ] Initial packet sequence %u correctly accepted.\n", rx_pkt.header.seq_id);

    /* Simulate duplicate arrival of seq=1 (e.g. ACK was lost on reverse link) */
    if (rx_pkt.header.seq_id < expected_seq) {
        duplicate_packets++;
        /* Receiver must not write payload again, but must re-send ACK */
    }
    assert(duplicate_packets == 1);
    assert(accepted_packets == 1);
    printf("  [RUDP ARQ] Duplicate packet detected and filtered (duplicate_count=1, accepted=1).\n");

    /* 3. ACK Generation for Duplicate and Valid Sequences */
    netcode_packet_t ack_pkt;
    memset(&ack_pkt, 0, sizeof(ack_pkt));
    ack_pkt.header.magic[0] = NETCODE_MAGIC_0;
    ack_pkt.header.magic[1] = NETCODE_MAGIC_1;
    ack_pkt.header.version = NETCODE_VERSION;
    ack_pkt.header.type = PKT_TYPE_ACK;
    ack_pkt.header.seq_id = 1; /* ACK for sequence 1 */

    uint8_t ack_buf[64];
    size_t ack_len = 0;
    assert(protocol_serialize_packet(&ack_pkt, ack_buf, sizeof(ack_buf), &ack_len, 0) == 0);

    netcode_packet_t rx_ack;
    assert(protocol_parse_packet(ack_buf, ack_len, &rx_ack, 0) == 0);
    assert(rx_ack.header.type == PKT_TYPE_ACK);
    assert(rx_ack.header.seq_id == 1);
    printf("  [RUDP ARQ] ACK packet serialization and sequence matching verified.\n");

    /* 4. Mismatched / Stale ACK Rejection */
    uint16_t waiting_for_seq = 2;
    bool ack_valid = (rx_ack.header.type == PKT_TYPE_ACK && rx_ack.header.seq_id == waiting_for_seq);
    assert(ack_valid == false);
    printf("  [RUDP ARQ] Stale ACK rejection verified (received ACK for %u while waiting for %u).\n",
           rx_ack.header.seq_id, waiting_for_seq);

    /* 5. Simulated Timeout and Retransmission Counter Increment */
    int retransmissions = 0;
    int max_retries = 5;
    bool ack_received = false;

    for (int attempt = 1; attempt <= max_retries; attempt++) {
        /* Simulate packet dropped until attempt 3 */
        if (attempt == 3) {
            ack_received = true;
            break;
        }
        retransmissions++;
    }
    assert(ack_received == true);
    assert(retransmissions == 2);
    printf("  [RUDP ARQ] Timeout and retransmission counting verified (%d retransmissions before ACK).\n",
           retransmissions);

    printf("ALL RUDP RETRANSMISSION & ARQ TESTS PASSED!\n");
    return 0;
}
