#include "transfer.h"
#include "events.h"
#include "gf256.h"
#include "sha256.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <errno.h>

static void format_coeffs(const uint8_t *coeffs, uint8_t K, char *out, size_t out_sz) {
    if (!coeffs || K == 0) {
        snprintf(out, out_sz, "[]");
        return;
    }
    snprintf(out, out_sz, "[");
    for (int i = 0; i < K; i++) {
        char num[16];
        snprintf(num, sizeof(num), "%u%s", coeffs[i], (i < K - 1) ? "," : "");
        strncat(out, num, out_sz - strlen(out) - 1);
    }
    strncat(out, "]", out_sz - strlen(out) - 1);
}

int rlnc_send_file(int sock, const char *dest_ip, int dest_port,
                   const char *filepath, size_t block_size, uint8_t K,
                   uint8_t redundancy, impairment_config_t *impair,
                   netcode_metrics_t *metrics)
{
    FILE *f = fopen(filepath, "rb");
    if (!f) {
        perror("rlnc_send_file fopen");
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
    tv.tv_usec = 100 * 1000; /* 100ms timeout for feedback */
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    /* Mathematically correct block and generation counts */
    size_t total_blocks = 0;
    size_t total_gens = 0;
    if (file_sz > 0) {
        total_blocks = ((size_t)file_sz + block_size - 1) / block_size;
        total_gens = (total_blocks + K - 1) / K;
    }

    uint16_t global_seq = 0;
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
        hs_init.header.crc32 = (uint32_t)file_sz;
        hs_init.header.block_id = (uint16_t)total_blocks;
        hs_init.header.payload_len = 0;
        size_t hs_len = 0;
        protocol_serialize_packet(&hs_init, tx_buf, sizeof(tx_buf), &hs_len, 0);

        bool ready = false;
        for (int attempt = 0; attempt < 8 && !ready; attempt++) {
            event_emit_handshake(1, "TRANSFER_INIT", "sender_to_receiver", "1. Sender -> Receiver: TRANSFER_INIT");
            ssize_t sent = sendto(sock, tx_buf, hs_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
            if (sent > 0) {
                printf("[HANDSHAKE-TX] Sent TRANSFER_INIT (len=%zd) -> %s:%d (attempt %d/8)\n",
                       sent, dest_ip, dest_port, attempt + 1);
                fflush(stdout);
            }

            struct sockaddr_in from_addr;
            socklen_t from_len = sizeof(from_addr);
            ssize_t n = recvfrom(sock, rx_buf, sizeof(rx_buf), 0, (struct sockaddr *)&from_addr, &from_len);
            if (n > 0) {
                netcode_packet_t hs_reply;
                if (protocol_parse_packet(rx_buf, (size_t)n, &hs_reply, 0) == 0 &&
                    hs_reply.header.type == PKT_TYPE_HANDSHAKE &&
                    hs_reply.header.seq_id == 2) {
                    char rip[INET_ADDRSTRLEN];
                    inet_ntop(AF_INET, &from_addr.sin_addr, rip, sizeof(rip));
                    printf("[HANDSHAKE-RX] Received TRANSFER_READY (len=%zd) <- %s:%d\n",
                           n, rip, ntohs(from_addr.sin_port));
                    fflush(stdout);
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
            ssize_t sent = sendto(sock, tx_buf, hs_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
            if (sent > 0) {
                printf("[HANDSHAKE-TX] Sent TRANSFER_START (len=%zd) -> %s:%d (Handshake Complete)\n",
                       sent, dest_ip, dest_port);
                fflush(stdout);
            }
            usleep(30000);
        }
    }

    /* For empty files: transmit ZERO data packets, send FIN, and exit cleanly */
    if (file_sz == 0 || total_gens == 0) {
        netcode_packet_t fin_pkt;
        memset(&fin_pkt, 0, sizeof(fin_pkt));
        fin_pkt.header.magic[0] = NETCODE_MAGIC_0;
        fin_pkt.header.magic[1] = NETCODE_MAGIC_1;
        fin_pkt.header.version = NETCODE_VERSION;
        fin_pkt.header.type = PKT_TYPE_FIN;
        fin_pkt.header.seq_id = global_seq++;
        fin_pkt.header.gen_id = 0;
        fin_pkt.header.block_id = 0;
        fin_pkt.header.payload_len = 0;
        fin_pkt.header.crc32 = 0;

        size_t fin_len = 0;
        protocol_serialize_packet(&fin_pkt, tx_buf, sizeof(tx_buf), &fin_len, 0);
        ssize_t sent = sendto(sock, tx_buf, fin_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
        if (sent > 0) {
            printf("[UDP-TX] Sent FIN packet seq=%u (Empty File) -> %s:%d\n", fin_pkt.header.seq_id, dest_ip, dest_port);
            fflush(stdout);
        }
        fclose(f);
        return 0;
    }

    for (size_t g = 0; g < total_gens; g++) {
        size_t gen_start_block = g * K;
        size_t gen_blocks = (gen_start_block + K <= total_blocks) ? K : (total_blocks - gen_start_block);
        uint8_t cur_K = (uint8_t)gen_blocks;

        rlnc_encoder_t enc;
        rlnc_encoder_init(&enc, cur_K, block_size);

        for (size_t b = 0; b < gen_blocks; b++) {
            uint8_t raw[MAX_PAYLOAD_SIZE];
            memset(raw, 0, block_size);
            fseek(f, (gen_start_block + b) * block_size, SEEK_SET);
            size_t bytes_read = fread(raw, 1, block_size, f);
            rlnc_encoder_set_block(&enc, (uint8_t)b, raw, bytes_read);
            event_emit_source_block_created((int)(gen_start_block + b), (gen_start_block + b) * block_size, bytes_read, raw);
        }

        /* 1. Transmit systematic packets */
        for (size_t b = 0; b < gen_blocks; b++) {
            netcode_packet_t pkt;
            memset(&pkt, 0, sizeof(pkt));
            pkt.header.magic[0] = NETCODE_MAGIC_0;
            pkt.header.magic[1] = NETCODE_MAGIC_1;
            pkt.header.version = NETCODE_VERSION;
            pkt.header.type = PKT_TYPE_DATA_RLNC;
            pkt.header.seq_id = global_seq++;
            pkt.header.gen_id = (uint16_t)g;
            pkt.header.block_id = (uint16_t)b;
            pkt.header.payload_len = (uint16_t)block_size;

            rlnc_encode_systematic(&enc, (uint8_t)b, pkt.coeffs, pkt.payload);
            pkt.header.crc32 = protocol_crc32(pkt.payload, block_size);

            size_t tx_len = 0;
            protocol_serialize_packet(&pkt, tx_buf, sizeof(tx_buf), &tx_len, cur_K);

            metrics->packets_sent++;
            event_emit_packet_transmitted(pkt.header.seq_id, (uint16_t)g, "Systematic", 1, pkt.coeffs, cur_K, block_size, pkt.payload);

            if (impair && impairment_should_drop(impair)) {
                metrics->packets_dropped++;
                event_emit_packet_dropped(pkt.header.seq_id, (uint16_t)g, 1, "Loss simulated");
                printf("[IMPAIRMENT-DROP] Dropped packet seq=%u gen=%u block=%u (Systematic, loss=%.1f%%)\n",
                       pkt.header.seq_id, (uint16_t)g, (uint16_t)b, impair->loss_rate * 100.0);
                fflush(stdout);
            } else {
                if (impair) impairment_apply_delay(impair);
                ssize_t sent = sendto(sock, tx_buf, tx_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
                if (sent > 0) {
                    printf("[UDP-TX] [RLNC] Sent pkt seq=%u gen=%u block=%u (Systematic) len=%zd bytes -> %s:%d\n",
                           pkt.header.seq_id, (uint16_t)g, (uint16_t)b, sent, dest_ip, dest_port);
                    fflush(stdout);
                }
            }
            usleep(2000);
        }

        /* 2. Transmit initial redundancy coded packets */
        for (size_t r = 0; r < redundancy; r++) {
            netcode_packet_t pkt;
            memset(&pkt, 0, sizeof(pkt));
            pkt.header.magic[0] = NETCODE_MAGIC_0;
            pkt.header.magic[1] = NETCODE_MAGIC_1;
            pkt.header.version = NETCODE_VERSION;
            pkt.header.type = PKT_TYPE_DATA_RLNC;
            pkt.header.seq_id = global_seq++;
            pkt.header.gen_id = (uint16_t)g;
            pkt.header.block_id = 0xFFFF;
            pkt.header.payload_len = (uint16_t)block_size;

            rlnc_encode_random(&enc, pkt.coeffs, pkt.payload);
            pkt.header.crc32 = protocol_crc32(pkt.payload, block_size);

            size_t tx_len = 0;
            protocol_serialize_packet(&pkt, tx_buf, sizeof(tx_buf), &tx_len, cur_K);

            char c_str[128];
            format_coeffs(pkt.coeffs, cur_K, c_str, sizeof(c_str));

            metrics->packets_sent++;
            metrics->coded_packets++;
            event_emit_packet_transmitted(pkt.header.seq_id, (uint16_t)g, "Mixed", 1, pkt.coeffs, cur_K, block_size, pkt.payload);

            if (impair && impairment_should_drop(impair)) {
                metrics->packets_dropped++;
                event_emit_packet_dropped(pkt.header.seq_id, (uint16_t)g, 1, "Loss simulated");
                printf("[IMPAIRMENT-DROP] Dropped coded pkt seq=%u gen=%u coeffs=%s (loss=%.1f%%)\n",
                       pkt.header.seq_id, (uint16_t)g, c_str, impair->loss_rate * 100.0);
                fflush(stdout);
            } else {
                if (impair) impairment_apply_delay(impair);
                ssize_t sent = sendto(sock, tx_buf, tx_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
                if (sent > 0) {
                    printf("[UDP-TX] [RLNC] Sent coded pkt seq=%u gen=%u coeffs=%s len=%zd bytes -> %s:%d\n",
                           pkt.header.seq_id, (uint16_t)g, c_str, sent, dest_ip, dest_port);
                    fflush(stdout);
                }
            }
            usleep(2000);
        }

        /* 3. Wait for generation completion ACK or request for more packets */
        bool gen_finished = false;
        int wait_loops = 0;

        int max_wait_loops = (cur_K * 3 > 25) ? (cur_K * 3) : 25;
        while (!gen_finished && wait_loops < max_wait_loops) {
            struct sockaddr_in from_addr;
            socklen_t from_len = sizeof(from_addr);
            ssize_t n;

            /* Check and drain any pending ACKs */
            while ((n = recvfrom(sock, rx_buf, sizeof(rx_buf), MSG_DONTWAIT, (struct sockaddr *)&from_addr, &from_len)) > 0) {
                netcode_packet_t ack_pkt;
                if (protocol_parse_packet(rx_buf, (size_t)n, &ack_pkt, cur_K) == 0) {
                    if (ack_pkt.header.type == PKT_TYPE_ACK && ack_pkt.header.gen_id == (uint16_t)g) {
                        char aip[INET_ADDRSTRLEN];
                        inet_ntop(AF_INET, &from_addr.sin_addr, aip, sizeof(aip));
                        printf("[UDP-ACK] [RLNC] Received validated ACK for Gen %u <- %s:%d (Complete)\n",
                               (uint16_t)g, aip, ntohs(from_addr.sin_port));
                        fflush(stdout);
                        gen_finished = true;
                        break;
                    }
                }
            }
            if (gen_finished) break;

            /* Give receiver a brief grace window on initial attempt before injecting repair packets */
            if (wait_loops == 0) {
                usleep(25000); /* 25ms initial processing window */
                wait_loops++;
                continue;
            }

            /* If not finished, generate and send an additional coded packet */
            netcode_packet_t extra_pkt;
            memset(&extra_pkt, 0, sizeof(extra_pkt));
            extra_pkt.header.magic[0] = NETCODE_MAGIC_0;
            extra_pkt.header.magic[1] = NETCODE_MAGIC_1;
            extra_pkt.header.version = NETCODE_VERSION;
            extra_pkt.header.type = PKT_TYPE_DATA_RLNC;
            extra_pkt.header.seq_id = global_seq++;
            extra_pkt.header.gen_id = (uint16_t)g;
            extra_pkt.header.block_id = 0xFFFF;
            extra_pkt.header.payload_len = (uint16_t)block_size;

            rlnc_encode_random(&enc, extra_pkt.coeffs, extra_pkt.payload);
            extra_pkt.header.crc32 = protocol_crc32(extra_pkt.payload, block_size);

            size_t tx_len = 0;
            protocol_serialize_packet(&extra_pkt, tx_buf, sizeof(tx_buf), &tx_len, cur_K);

            char c_str[128];
            format_coeffs(extra_pkt.coeffs, cur_K, c_str, sizeof(c_str));

            metrics->packets_sent++;
            metrics->coded_packets++;
            event_emit_packet_transmitted(extra_pkt.header.seq_id, (uint16_t)g, "Mixed (Retransmit)", 2, extra_pkt.coeffs, cur_K, block_size, extra_pkt.payload);

            if (impair && impairment_should_drop(impair)) {
                metrics->packets_dropped++;
                event_emit_packet_dropped(extra_pkt.header.seq_id, (uint16_t)g, 2, "Loss simulated");
                printf("[IMPAIRMENT-DROP] Dropped repair coded pkt seq=%u gen=%u coeffs=%s\n",
                       extra_pkt.header.seq_id, (uint16_t)g, c_str);
                fflush(stdout);
            } else {
                if (impair) impairment_apply_delay(impair);
                ssize_t sent = sendto(sock, tx_buf, tx_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
                if (sent > 0) {
                    printf("[UDP-TX] [RLNC] Sent repair coded pkt seq=%u gen=%u coeffs=%s len=%zd bytes -> %s:%d\n",
                           extra_pkt.header.seq_id, (uint16_t)g, c_str, sent, dest_ip, dest_port);
                    fflush(stdout);
                }
            }

            wait_loops++;
            usleep(10000);
        }

        if (!gen_finished) {
            fprintf(stderr, "rlnc_send_file: Generation %zu failed to achieve full rank within budget\n", g);
            fclose(f);
            return -1;
        }
    }

    /* Send FIN packet */
    for (int fin_attempts = 0; fin_attempts < 5; fin_attempts++) {
        netcode_packet_t fin_pkt;
        memset(&fin_pkt, 0, sizeof(fin_pkt));
        fin_pkt.header.magic[0] = NETCODE_MAGIC_0;
        fin_pkt.header.magic[1] = NETCODE_MAGIC_1;
        fin_pkt.header.version = NETCODE_VERSION;
        fin_pkt.header.type = PKT_TYPE_FIN;
        fin_pkt.header.seq_id = global_seq++;
        fin_pkt.header.gen_id = (uint16_t)total_gens;
        fin_pkt.header.block_id = 0;
        fin_pkt.header.payload_len = 0;
        fin_pkt.header.crc32 = 0;

        size_t fin_len = 0;
        protocol_serialize_packet(&fin_pkt, tx_buf, sizeof(tx_buf), &fin_len, 0);
        ssize_t sent = sendto(sock, tx_buf, fin_len, 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
        if (sent > 0 && fin_attempts == 0) {
            printf("[UDP-TX] Sent FIN packet seq=%u (len=%zd) -> %s:%d\n", fin_pkt.header.seq_id, sent, dest_ip, dest_port);
            fflush(stdout);
        }
        usleep(10000);
    }

    fclose(f);
    return 0;
}

int rlnc_receive_file(int sock, const char *out_filepath,
                      size_t block_size, uint8_t K, size_t original_file_size,
                      impairment_config_t *impair, netcode_metrics_t *metrics)
{
    FILE *out = fopen(out_filepath, "wb+");
    if (!out) {
        perror("rlnc_receive_file fopen");
        return -1;
    }

    struct timeval tv;
    tv.tv_sec = 6; /* 6s inactivity timeout */
    tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    size_t total_blocks = 0;
    size_t total_gens = 0;
    if (original_file_size > 0) {
        total_blocks = (original_file_size + block_size - 1) / block_size;
        total_gens = (total_blocks + K - 1) / K;
    }

    rlnc_decoder_t decoders[MAX_SUPPORTED_GENS];
    bool gen_decoded[MAX_SUPPORTED_GENS];
    uint8_t gen_k[MAX_SUPPORTED_GENS];
    memset(gen_decoded, 0, sizeof(gen_decoded));
    memset(gen_k, 0, sizeof(gen_k));

    for (size_t g = 0; g < total_gens && g < MAX_SUPPORTED_GENS; g++) {
        size_t gen_start_block = g * K;
        size_t gen_blocks = (gen_start_block + K <= total_blocks) ? K : (total_blocks - gen_start_block);
        gen_k[g] = (uint8_t)gen_blocks;
        rlnc_decoder_init(&decoders[g], gen_k[g], block_size);
    }

    uint8_t rx_buf[2048];
    uint8_t tx_buf[2048];
    size_t total_recovered_blocks = 0;

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
                char sip[INET_ADDRSTRLEN];
                inet_ntop(AF_INET, &sender_addr.sin_addr, sip, sizeof(sip));
                int sport = ntohs(sender_addr.sin_port);

                if (hs_pkt.header.type == PKT_TYPE_HANDSHAKE && hs_pkt.header.seq_id == 1) {
                    if (original_file_size == 0 && hs_pkt.header.crc32 > 0) {
                        original_file_size = (size_t)hs_pkt.header.crc32;
                        total_blocks = (original_file_size + block_size - 1) / block_size;
                        total_gens = (total_blocks + K - 1) / K;
                        for (size_t g = 0; g < total_gens && g < MAX_SUPPORTED_GENS; g++) {
                            size_t gen_start_block = g * K;
                            size_t gen_blocks = (gen_start_block + K <= total_blocks) ? K : (total_blocks - gen_start_block);
                            gen_k[g] = (uint8_t)gen_blocks;
                            rlnc_decoder_init(&decoders[g], gen_k[g], block_size);
                        }
                    }
                    printf("[HANDSHAKE-RX] Received TRANSFER_INIT (len=%zd, size=%zu) <- %s:%d\n", n, original_file_size, sip, sport);
                    fflush(stdout);
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
                    ssize_t sent = sendto(sock, hs_buf, rep_len, 0, (struct sockaddr *)&sender_addr, sender_len);
                    if (sent > 0) {
                        printf("[HANDSHAKE-TX] Sent TRANSFER_READY (len=%zd) -> %s:%d\n", sent, sip, sport);
                        fflush(stdout);
                    }

                    // Wait for TRANSFER_START
                    ssize_t n2 = recvfrom(sock, hs_buf, sizeof(hs_buf), 0, (struct sockaddr *)&sender_addr, &sender_len);
                    if (n2 > 0) {
                        netcode_packet_t hs_start;
                        if (protocol_parse_packet(hs_buf, (size_t)n2, &hs_start, 0) == 0 &&
                            hs_start.header.type == PKT_TYPE_HANDSHAKE &&
                            hs_start.header.seq_id == 3) {
                            printf("[HANDSHAKE-RX] Received TRANSFER_START (len=%zd) <- %s:%d (Handshake Established)\n", n2, sip, sport);
                            fflush(stdout);
                            event_emit_handshake(4, "INITIALIZATION_COMPLETE", "all", "Handshake Established");
                            init_done = true;
                        }
                    }
                } else if (hs_pkt.header.type == PKT_TYPE_DATA_RLNC || hs_pkt.header.type == PKT_TYPE_FIN) {
                    init_done = true;
                }
            }
        }
    }

    /* For empty file: zero data blocks to receive, flush empty file, emit progress, and exit */
    if (original_file_size == 0 || total_gens == 0) {
        event_emit_reconstruction_progress(0, 0, 100);
        fflush(out);
        (void)!ftruncate(fileno(out), 0);
        fclose(out);
        return 0;
    }

    while (1) {
        struct sockaddr_in sender_addr;
        socklen_t sender_len = sizeof(sender_addr);
        ssize_t n = recvfrom(sock, rx_buf, sizeof(rx_buf), 0, (struct sockaddr *)&sender_addr, &sender_len);

        if (n <= 0) {
            break;
        }

        const netcode_header_t *hdr = (const netcode_header_t *)rx_buf;
        if ((size_t)n < sizeof(netcode_header_t)) continue;

        uint16_t g = hdr->gen_id;
        uint8_t cur_K = (g < total_gens) ? gen_k[g] : K;

        netcode_packet_t pkt;
        if (protocol_parse_packet(rx_buf, (size_t)n, &pkt, cur_K) != 0) {
            continue;
        }

        char sip[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &sender_addr.sin_addr, sip, sizeof(sip));
        int sport = ntohs(sender_addr.sin_port);

        if (pkt.header.type == PKT_TYPE_FIN) {
            printf("[UDP-RX] Received FIN packet seq=%u gen=%u (len=%zd) <- %s:%d\n",
                   pkt.header.seq_id, pkt.header.gen_id, n, sip, sport);
            fflush(stdout);

            /* Reply with FIN-ACK */
            netcode_packet_t ack;
            memset(&ack, 0, sizeof(ack));
            ack.header.magic[0] = NETCODE_MAGIC_0;
            ack.header.magic[1] = NETCODE_MAGIC_1;
            ack.header.version = NETCODE_VERSION;
            ack.header.type = PKT_TYPE_ACK;
            ack.header.seq_id = pkt.header.seq_id;
            ack.header.gen_id = pkt.header.gen_id;
            size_t ack_len = 0;
            protocol_serialize_packet(&ack, tx_buf, sizeof(tx_buf), &ack_len, 0);
            ssize_t sent = sendto(sock, tx_buf, ack_len, 0, (struct sockaddr *)&sender_addr, sender_len);
            if (sent > 0) {
                printf("[UDP-ACK] Sent FIN-ACK seq=%u (len=%zd) -> %s:%d\n", ack.header.seq_id, sent, sip, sport);
                fflush(stdout);
            }
            break;
        }

        if (pkt.header.type != PKT_TYPE_DATA_RLNC) {
            continue;
        }

        if (g >= total_gens) continue;

        char c_str[128];
        format_coeffs(pkt.coeffs, cur_K, c_str, sizeof(c_str));

        metrics->packets_received++;
        event_emit_packet_received(pkt.header.seq_id, g, pkt.header.payload_len, pkt.coeffs, cur_K, pkt.payload);

        printf("[UDP-RX] [RLNC] Received pkt seq=%u gen=%u coeffs=%s len=%zd bytes <- %s:%d\n",
               pkt.header.seq_id, g, c_str, n, sip, sport);
        fflush(stdout);

        if (!gen_decoded[g]) {
            int prev_rank = decoders[g].rank;
            bool innovative = rlnc_decoder_add_packet(&decoders[g], pkt.coeffs, pkt.payload, g);
            if (innovative) {
                metrics->independent_packets++;
                printf("[RLNC-DECODER] Gen %u: Innovative packet (coeffs=%s). Rank: %d -> %d / %d\n",
                       g, c_str, prev_rank, decoders[g].rank, cur_K);
            } else {
                metrics->dependent_packets++;
                printf("[RLNC-DECODER] Gen %u: Redundant packet (coeffs=%s). Rank unchanged: %d / %d\n",
                       g, c_str, decoders[g].rank, cur_K);
            }
            fflush(stdout);

            event_emit_decoder_matrix_update(g, decoders[g].rank, cur_K, innovative);

            if (rlnc_decoder_is_complete(&decoders[g])) {
                gen_decoded[g] = true;
                printf("[RLNC-DECODER] Gen %u: FULL RANK ACHIEVED (%d/%d)! Decoding all %d source blocks via Gaussian Elimination.\n",
                       g, decoders[g].rank, cur_K, cur_K);
                fflush(stdout);

                /* Write decoded blocks of this generation to out file */
                size_t gen_start_block = g * K;
                size_t gen_blocks = gen_k[g];

                for (size_t b = 0; b < gen_blocks; b++) {
                    uint8_t out_blk[MAX_PAYLOAD_SIZE];
                    size_t blk_len = 0;
                    rlnc_decoder_get_block(&decoders[g], (uint8_t)b, out_blk, &blk_len);

                    size_t file_offset = (gen_start_block + b) * block_size;
                    fseek(out, (long)file_offset, SEEK_SET);

                    /* Handle last block truncation */
                    size_t to_write = block_size;
                    if (file_offset + to_write > original_file_size) {
                        to_write = original_file_size - file_offset;
                    }
                    fwrite(out_blk, 1, to_write, out);
                    total_recovered_blocks++;
                }

                int pct = (int)((total_recovered_blocks * 100) / total_blocks);
                event_emit_reconstruction_progress(total_recovered_blocks, total_blocks, pct);
            }
        }

        /* If generation is decoded, send ACK */
        if (gen_decoded[g]) {
            netcode_packet_t ack;
            memset(&ack, 0, sizeof(ack));
            ack.header.magic[0] = NETCODE_MAGIC_0;
            ack.header.magic[1] = NETCODE_MAGIC_1;
            ack.header.version = NETCODE_VERSION;
            ack.header.type = PKT_TYPE_ACK;
            ack.header.seq_id = pkt.header.seq_id;
            ack.header.gen_id = g;
            size_t ack_len = 0;
            protocol_serialize_packet(&ack, tx_buf, sizeof(tx_buf), &ack_len, cur_K);

            if (impair && impairment_should_drop(impair)) {
                /* Drop ACK in simulation */
                printf("[IMPAIRMENT-DROP] Dropped Gen %u completion ACK in simulation\n", g);
                fflush(stdout);
            } else {
                ssize_t sent = sendto(sock, tx_buf, ack_len, 0, (struct sockaddr *)&sender_addr, sender_len);
                if (sent > 0) {
                    printf("[UDP-ACK] [RLNC] Sent Gen %u completion ACK (len=%zd) -> %s:%d\n", g, sent, sip, sport);
                    fflush(stdout);
                }
            }
        }
    }

    bool all_gens_recovered = true;
    for (size_t g = 0; g < total_gens && g < MAX_SUPPORTED_GENS; g++) {
        if (!gen_decoded[g]) {
            all_gens_recovered = false;
            break;
        }
    }

    fflush(out);
    if (ftruncate(fileno(out), original_file_size) != 0) {
        /* Truncate handled */
    }
    fclose(out);

    if (!all_gens_recovered) {
        fprintf(stderr, "rlnc_receive_file: Incomplete transfer, not all generations recovered\n");
        return -1;
    }
    return 0;
}
