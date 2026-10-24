#include <stdio.h>
#include <assert.h>
#include <string.h>
#include "protocol.h"
#include "sha256.h"

int main() {
    printf("Running Reliable UDP and SHA-256 Tests...\n");

    /* Test SHA-256 known vector: "abc" */
    const char *msg = "abc";
    sha256_ctx ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, (const uint8_t *)msg, strlen(msg));
    uint8_t hash[32];
    sha256_final(&ctx, hash);

    char hex[65];
    for (int i = 0; i < 32; i++) {
        sprintf(hex + (i * 2), "%02x", hash[i]);
    }
    hex[64] = '\0';

    /* NIST standard SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad */
    assert(strcmp(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0);

    /* Test ACK serialization */
    netcode_packet_t ack;
    memset(&ack, 0, sizeof(ack));
    ack.header.magic[0] = NETCODE_MAGIC_0;
    ack.header.magic[1] = NETCODE_MAGIC_1;
    ack.header.version = NETCODE_VERSION;
    ack.header.type = PKT_TYPE_ACK;
    ack.header.seq_id = 99;

    uint8_t buf[128];
    size_t out_len = 0;
    assert(protocol_serialize_packet(&ack, buf, sizeof(buf), &out_len, 0) == 0);

    netcode_packet_t parsed_ack;
    assert(protocol_parse_packet(buf, out_len, &parsed_ack, 0) == 0);
    assert(parsed_ack.header.type == PKT_TYPE_ACK);
    assert(parsed_ack.header.seq_id == 99);

    printf("ALL RELIABLE UDP AND SHA-256 TESTS PASSED!\n");
    return 0;
}
