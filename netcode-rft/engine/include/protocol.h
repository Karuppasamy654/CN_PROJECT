#ifndef NETCODE_PROTOCOL_H
#define NETCODE_PROTOCOL_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define NETCODE_MAGIC_0 0x4E /* 'N' */
#define NETCODE_MAGIC_1 0x43 /* 'C' */
#define NETCODE_VERSION 1

#define MAX_PAYLOAD_SIZE 1024
#define MAX_GENERATION_K 32

typedef enum {
    PKT_TYPE_DATA_RLNC = 0x01,
    PKT_TYPE_DATA_RUDP = 0x02,
    PKT_TYPE_ACK       = 0x04,
    PKT_TYPE_FIN       = 0x08,
    PKT_TYPE_HANDSHAKE = 0x10
} packet_type_t;

#pragma pack(push, 1)
typedef struct {
    uint8_t  magic[2];       /* 'N', 'C' */
    uint8_t  version;        /* 1 */
    uint8_t  type;           /* packet_type_t */
    uint16_t seq_id;         /* Sequence / Packet ID */
    uint16_t gen_id;         /* Generation ID */
    uint16_t block_id;       /* Source Block ID (RUDP or systematic) */
    uint16_t payload_len;    /* Byte count of payload */
    uint32_t crc32;          /* CRC32 of payload */
} netcode_header_t;
#pragma pack(pop)

typedef struct {
    netcode_header_t header;
    uint8_t coeffs[MAX_GENERATION_K]; /* RLNC coding coefficient vector */
    uint8_t payload[MAX_PAYLOAD_SIZE];
} netcode_packet_t;

uint32_t protocol_crc32(const uint8_t *data, size_t len);

int protocol_serialize_packet(const netcode_packet_t *pkt, uint8_t *buf, size_t buf_max, size_t *out_len, uint8_t K);
int protocol_parse_packet(const uint8_t *buf, size_t buf_len, netcode_packet_t *pkt, uint8_t K);

#endif /* NETCODE_PROTOCOL_H */
