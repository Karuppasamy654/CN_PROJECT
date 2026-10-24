#include <stdio.h>
#include <assert.h>
#include <string.h>
#include "protocol.h"

int main() {
    printf("Running Protocol Unit Tests...\n");

    uint8_t K = 4;
    netcode_packet_t pkt;
    memset(&pkt, 0, sizeof(pkt));
    pkt.header.magic[0] = NETCODE_MAGIC_0;
    pkt.header.magic[1] = NETCODE_MAGIC_1;
    pkt.header.version = NETCODE_VERSION;
    pkt.header.type = PKT_TYPE_DATA_RLNC;
    pkt.header.seq_id = 42;
    pkt.header.gen_id = 3;
    pkt.header.block_id = 1;
    pkt.header.payload_len = 16;
    memset(pkt.coeffs, 0x05, K);
    strcpy((char *)pkt.payload, "HelloNetCode123");
    pkt.header.crc32 = protocol_crc32(pkt.payload, pkt.header.payload_len);

    uint8_t buf[256];
    size_t out_len = 0;
    int ser_res = protocol_serialize_packet(&pkt, buf, sizeof(buf), &out_len, K);
    assert(ser_res == 0);
    assert(out_len > sizeof(netcode_header_t) + K);

    netcode_packet_t parsed;
    int parse_res = protocol_parse_packet(buf, out_len, &parsed, K);
    assert(parse_res == 0);
    assert(parsed.header.seq_id == 42);
    assert(parsed.header.gen_id == 3);
    assert(parsed.header.payload_len == 16);
    assert(memcmp(parsed.coeffs, pkt.coeffs, K) == 0);
    assert(memcmp(parsed.payload, pkt.payload, 16) == 0);

    /* Test CRC tampering detection */
    buf[sizeof(netcode_header_t) + K + 2] ^= 0xFF;
    int corrupt_res = protocol_parse_packet(buf, out_len, &parsed, K);
    assert(corrupt_res != 0);

    printf("ALL PROTOCOL UNIT TESTS PASSED!\n");
    return 0;
}
