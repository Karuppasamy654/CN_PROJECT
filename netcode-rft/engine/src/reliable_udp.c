#include "reliable_udp.h"
#include "events.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <errno.h>

int rudp_send_file(int sock, const char *dest_ip, int dest_port,
                   const char *filepath, size_t block_size,
                   impairment_config_t *impair, netcode_metrics_t *metrics)
{
    FILE *f = fopen(filepath, "rb");
    if (!f) {
        perror("rudp_send_file fopen");
        return -1;
    }

    fseek(f, 0, SEEK_END);
    long file_sz = ftell(f);
    fseek(f, 0, SEEK_SET);

    struct sockaddr_in dest_addr;
    memset(&dest_addr, 0, sizeof(dest_addr));
    dest_addr.sin_family = AF_INET;
    dest_addr.sin_port = htons(dest_port);
    inet_pton(AF_INET, dest_ip, &dest_addr.sin_addr);

    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = RUDP_TIMEOUT_MS * 1000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    uint16_t seq = 0;
    size_t total_blocks = (file_sz + block_size - 1) / block_size;
    if (total_blocks == 0) total_blocks = 1;

    uint8_t payload[MAX_PAYLOAD_SIZE];
    uint8_t tx_buf[2048];
    uint8_t rx_buf[2048];

    /* Application-Level UDP Handshake */
    {
        netcode_packet_t hs_init;
        memset(&hs_init, 0, sizeof(hs_init));
        hs_init.header.magic[0] = NETCODE_MAGIC_0;
        hs_init.header.magic[1] = NETCODE_MAGIC_1;
        hs_init.header.version = NETCODE_VERSION;
        hs_init.header.type = PKT_TYPE_HANDSHAKE;
        hs_init.header.seq_id = 1; /* TRANSFER_INIT */
        hs_init.header.payload_len = 0;
        size_t hs_len = 0;
        protocol_serialize_packet(&hs_init, tx_buf, sizeof(tx_buf), &hs_len, 0);

        bool ready = false;
        for (int attempt = 0; attempt < 8 && !ready; attempt++) {
            event_emit_handshake(1, "TRANSFER_INIT", "sender_to_receiver", "1. Sender -> Receiver: TRANSFER_INIT");
            sendto(sock, tx_buf, hs_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));

            struct sockaddr_in from_addr;
            socklen_t from_len = sizeof(from_addr);
            ssize_t n = recvfrom(sock, rx_buf, sizeof(rx_buf), 0, (struct sockaddr *)&from_addr, &from_len);
            if (n > 0) {
                netcode_packet_t hs_reply;
                if (protocol_parse_packet(rx_buf, (size_t)n, &hs_reply, 0) == 0 &&
                    hs_reply.header.type == PKT_TYPE_HANDSHAKE &&
                    hs_reply.header.seq_id == 2) {
                    ready = true;
                    break;
                }
            }
            usleep(20000);
        }

        if (ready) {
            netcode_packet_t hs_start;
            memset(&hs_start, 0, sizeof(hs_start));
            hs_start.header.magic[0] = NETCODE_MAGIC_0;
            hs_start.header.magic[1] = NETCODE_MAGIC_1;
            hs_start.header.version = NETCODE_VERSION;
            hs_start.header.type = PKT_TYPE_HANDSHAKE;
            hs_start.header.seq_id = 3; /* TRANSFER_START */
            hs_start.header.payload_len = 0;
            protocol_serialize_packet(&hs_start, tx_buf, sizeof(tx_buf), &hs_len, 0);
            event_emit_handshake(3, "TRANSFER_START", "sender_to_receiver", "3. Sender -> Receiver: TRANSFER_START");
            sendto(sock, tx_buf, hs_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
            usleep(30000);
        }
    }

    for (size_t b = 0; b < total_blocks; b++) {
        size_t bytes_read = fread(payload, 1, block_size, f);
        event_emit_source_block_created((int)b, b * block_size, bytes_read, payload);

        netcode_packet_t pkt;
        memset(&pkt, 0, sizeof(pkt));
        pkt.header.magic[0] = NETCODE_MAGIC_0;
        pkt.header.magic[1] = NETCODE_MAGIC_1;
        pkt.header.version = NETCODE_VERSION;
        pkt.header.type = PKT_TYPE_DATA_RUDP;
        pkt.header.seq_id = seq;
        pkt.header.gen_id = 0;
        pkt.header.block_id = (uint16_t)b;
        pkt.header.payload_len = (uint16_t)bytes_read;
        pkt.header.crc32 = protocol_crc32(payload, bytes_read);
        memcpy(pkt.payload, payload, bytes_read);

        size_t tx_len = 0;
        protocol_serialize_packet(&pkt, tx_buf, sizeof(tx_buf), &tx_len, 0);

        int retries = 0;
        bool acked = false;

        while (!acked && retries < RUDP_MAX_RETRIES) {
            metrics->packets_sent++;
            event_emit_packet_transmitted(seq, 0, "RUDP", NULL, 0, bytes_read, payload);

            if (impair && impairment_should_drop(impair)) {
                metrics->packets_dropped++;
                event_emit_packet_dropped(seq, 0, "Loss simulated");
            } else {
                if (impair) impairment_apply_delay(impair);
                sendto(sock, tx_buf, tx_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
            }

            /* Wait for ACK */
            struct sockaddr_in from_addr;
            socklen_t from_len = sizeof(from_addr);
            ssize_t n = recvfrom(sock, rx_buf, sizeof(rx_buf), 0, (struct sockaddr *)&from_addr, &from_len);

            if (n > 0) {
                netcode_packet_t ack_pkt;
                if (protocol_parse_packet(rx_buf, (size_t)n, &ack_pkt, 0) == 0) {
                    if (ack_pkt.header.type == PKT_TYPE_ACK && ack_pkt.header.seq_id == seq) {
                        acked = true;
                        event_emit_rudp_ack(ack_pkt.header.seq_id, seq);
                        break;
                    }
                }
            }

            retries++;
            if (!acked) {
                metrics->retransmissions++;
                event_emit_rudp_retransmit(seq, retries);
            }
        }

        if (!acked) {
            fclose(f);
            return -1; /* Exceeded max retries */
        }

        seq++;
    }

    /* Send FIN packet */
    for (int fin_attempts = 0; fin_attempts < 5; fin_attempts++) {
        netcode_packet_t fin_pkt;
        memset(&fin_pkt, 0, sizeof(fin_pkt));
        fin_pkt.header.magic[0] = NETCODE_MAGIC_0;
        fin_pkt.header.magic[1] = NETCODE_MAGIC_1;
        fin_pkt.header.version = NETCODE_VERSION;
        fin_pkt.header.type = PKT_TYPE_FIN;
        fin_pkt.header.seq_id = seq;
        fin_pkt.header.gen_id = 0;
        fin_pkt.header.block_id = (uint16_t)total_blocks;
        fin_pkt.header.payload_len = 0;
        fin_pkt.header.crc32 = 0;

        size_t fin_len = 0;
        protocol_serialize_packet(&fin_pkt, tx_buf, sizeof(tx_buf), &fin_len, 0);
        sendto(sock, tx_buf, fin_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
        usleep(10000);
    }

    fclose(f);
    return 0;
}

int rudp_receive_file(int sock, const char *out_filepath,
                      size_t original_file_size, size_t block_size,
                      impairment_config_t *impair, netcode_metrics_t *metrics)
{
    FILE *out = fopen(out_filepath, "wb");
    if (!out) {
        perror("rudp_receive_file fopen");
        return -1;
    }

    struct timeval tv;
    tv.tv_sec = 5; /* 5s inactivity timeout */
    tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    uint8_t rx_buf[2048];
    uint8_t tx_buf[2048];
    uint16_t expected_seq = 0;
    size_t total_written = 0;

    /* Application-Level UDP Handshake */
    {
        struct sockaddr_in sender_addr;
        socklen_t sender_len = sizeof(sender_addr);
        uint8_t hs_buf[2048];
        bool init_done = false;

        while (!init_done) {
            ssize_t n = recvfrom(sock, hs_buf, sizeof(hs_buf), 0, (struct sockaddr *)&sender_addr, &sender_len);
            if (n <= 0) break;

            netcode_packet_t hs_pkt;
            if (protocol_parse_packet(hs_buf, (size_t)n, &hs_pkt, 0) == 0) {
                if (hs_pkt.header.type == PKT_TYPE_HANDSHAKE && hs_pkt.header.seq_id == 1) {
                    event_emit_handshake(2, "TRANSFER_READY", "receiver_to_sender", "2. Receiver -> Sender: TRANSFER_READY");

                    netcode_packet_t hs_ready;
                    memset(&hs_ready, 0, sizeof(hs_ready));
                    hs_ready.header.magic[0] = NETCODE_MAGIC_0;
                    hs_ready.header.magic[1] = NETCODE_MAGIC_1;
                    hs_ready.header.version = NETCODE_VERSION;
                    hs_ready.header.type = PKT_TYPE_HANDSHAKE;
                    hs_ready.header.seq_id = 2; /* TRANSFER_READY */
                    size_t rep_len = 0;
                    protocol_serialize_packet(&hs_ready, hs_buf, sizeof(hs_buf), &rep_len, 0);
                    sendto(sock, hs_buf, rep_len, 0, (struct sockaddr *)&sender_addr, sender_len);

                    // Wait for TRANSFER_START
                    ssize_t n2 = recvfrom(sock, hs_buf, sizeof(hs_buf), 0, (struct sockaddr *)&sender_addr, &sender_len);
                    if (n2 > 0) {
                        netcode_packet_t hs_start;
                        if (protocol_parse_packet(hs_buf, (size_t)n2, &hs_start, 0) == 0 &&
                            hs_start.header.type == PKT_TYPE_HANDSHAKE &&
                            hs_start.header.seq_id == 3) {
                            event_emit_handshake(4, "INITIALIZATION_COMPLETE", "all", "Handshake Established");
                            init_done = true;
                        }
                    }
                } else if (hs_pkt.header.type == PKT_TYPE_DATA_RUDP) {
                    init_done = true;
                }
            }
        }
    }

    while (1) {
        struct sockaddr_in sender_addr;
        socklen_t sender_len = sizeof(sender_addr);
        ssize_t n = recvfrom(sock, rx_buf, sizeof(rx_buf), 0, (struct sockaddr *)&sender_addr, &sender_len);

        if (n <= 0) {
            /* Timeout or finished */
            break;
        }

        netcode_packet_t pkt;
        if (protocol_parse_packet(rx_buf, (size_t)n, &pkt, 0) != 0) {
            continue;
        }

        if (pkt.header.type == PKT_TYPE_FIN) {
            /* Send FIN-ACK and exit */
            netcode_packet_t ack;
            memset(&ack, 0, sizeof(ack));
            ack.header.magic[0] = NETCODE_MAGIC_0;
            ack.header.magic[1] = NETCODE_MAGIC_1;
            ack.header.version = NETCODE_VERSION;
            ack.header.type = PKT_TYPE_ACK;
            ack.header.seq_id = pkt.header.seq_id;
            size_t ack_len = 0;
            protocol_serialize_packet(&ack, tx_buf, sizeof(tx_buf), &ack_len, 0);
            sendto(sock, tx_buf, ack_len, 0, (struct sockaddr *)&sender_addr, sender_len);
            break;
        }

        if (pkt.header.type != PKT_TYPE_DATA_RUDP) {
            continue;
        }

        metrics->packets_received++;
        event_emit_packet_received(pkt.header.seq_id, pkt.header.gen_id, pkt.header.payload_len, NULL, 0, pkt.payload);

        /* Send ACK back regardless (in case previous ACK was lost) */
        netcode_packet_t ack;
        memset(&ack, 0, sizeof(ack));
        ack.header.magic[0] = NETCODE_MAGIC_0;
        ack.header.magic[1] = NETCODE_MAGIC_1;
        ack.header.version = NETCODE_VERSION;
        ack.header.type = PKT_TYPE_ACK;
        ack.header.seq_id = pkt.header.seq_id;
        size_t ack_len = 0;
        protocol_serialize_packet(&ack, tx_buf, sizeof(tx_buf), &ack_len, 0);

        if (impair && impairment_should_drop(impair)) {
            /* Drop ACK simulation */
        } else {
            sendto(sock, tx_buf, ack_len, 0, (struct sockaddr *)&sender_addr, sender_len);
        }

        if (pkt.header.seq_id == expected_seq) {
            if (pkt.header.payload_len > 0) {
                fwrite(pkt.payload, 1, pkt.header.payload_len, out);
                total_written += pkt.header.payload_len;
            }
            expected_seq++;
            size_t total_blocks = (original_file_size + block_size - 1) / (block_size > 0 ? block_size : 1);
            if (total_blocks == 0) total_blocks = 1;
            int pct = (original_file_size > 0) ? (int)((total_written * 100) / original_file_size) : 100;
            if (pct > 100) pct = 100;
            event_emit_reconstruction_progress(expected_seq, total_blocks, pct);
        }
    }

    fflush(out);
    fclose(out);
    return 0;
}
