#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <getopt.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <sys/stat.h>

#include "protocol.h"
#include "impairment.h"
#include "events.h"
#include "metrics.h"
#include "gf256.h"
#include "sha256.h"
#include "rlnc.h"
#include "reliable_udp.h"
#include "transfer.h"

typedef struct {
    char transfer_id[64];
    char protocol[16];   /* "rlnc" or "rudp" */
    char file_path[512];
    char out_path[1024];
    char ip[64];
    int port;
    double loss_rate;
    int delay_ms;
    int reorder;
    int block_size;
    int K;
    int redundancy;
    char role[16];       /* "all", "sender", "receiver" */
} engine_args_t;

static engine_args_t g_args;

static void compute_sha256_hex(const char *filepath, char *hex_out, size_t *out_size) {
    *out_size = 0;
    hex_out[0] = '\0';
    FILE *f = fopen(filepath, "rb");
    if (!f) return;

    sha256_ctx ctx;
    sha256_init(&ctx);

    uint8_t buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        sha256_update(&ctx, buf, n);
        *out_size += n;
    }
    fclose(f);

    uint8_t hash[32];
    sha256_final(&ctx, hash);
    for (int i = 0; i < 32; i++) {
        sprintf(hex_out + (i * 2), "%02x", hash[i]);
    }
    hex_out[64] = '\0';
}

static bool compare_files_byte_for_byte(const char *f1, const char *f2) {
    FILE *a = fopen(f1, "rb");
    FILE *b = fopen(f2, "rb");
    if (!a || !b) {
        if (a) fclose(a);
        if (b) fclose(b);
        return false;
    }

    uint8_t b1[4096], b2[4096];
    bool same = true;
    while (1) {
        size_t n1 = fread(b1, 1, sizeof(b1), a);
        size_t n2 = fread(b2, 1, sizeof(b2), b);
        if (n1 != n2) {
            same = false;
            break;
        }
        if (n1 == 0) break;
        if (memcmp(b1, b2, n1) != 0) {
            same = false;
            break;
        }
    }
    fclose(a);
    fclose(b);
    return same;
}

typedef struct {
    int rx_sock;
    int tx_sock;
    size_t orig_sz;
    netcode_metrics_t *metrics;
    impairment_config_t *impair;
    int rx_res;
    int tx_res;
} thread_ctx_t;

static void *receiver_thread(void *arg) {
    thread_ctx_t *ctx = (thread_ctx_t *)arg;
    if (strcmp(g_args.protocol, "rudp") == 0) {
        ctx->rx_res = rudp_receive_file(ctx->rx_sock, g_args.out_path, ctx->orig_sz, g_args.block_size, ctx->impair, ctx->metrics);
    } else {
        ctx->rx_res = rlnc_receive_file(ctx->rx_sock, g_args.out_path, g_args.block_size, g_args.K, ctx->orig_sz, ctx->impair, ctx->metrics);
    }
    return NULL;
}

static void *sender_thread(void *arg) {
    thread_ctx_t *ctx = (thread_ctx_t *)arg;
    usleep(50000); /* 50ms wait for receiver bind */
    if (strcmp(g_args.protocol, "rudp") == 0) {
        ctx->tx_res = rudp_send_file(ctx->tx_sock, g_args.ip, g_args.port, g_args.file_path, g_args.block_size, ctx->impair, ctx->metrics);
    } else {
        ctx->tx_res = rlnc_send_file(ctx->tx_sock, g_args.ip, g_args.port, g_args.file_path, g_args.block_size, g_args.K, g_args.redundancy, ctx->impair, ctx->metrics);
    }
    return NULL;
}

int main(int argc, char *argv[]) {
    gf256_init();

    memset(&g_args, 0, sizeof(g_args));
    strcpy(g_args.transfer_id, "transfer-001");
    strcpy(g_args.protocol, "rlnc");
    strcpy(g_args.ip, "127.0.0.1");
    g_args.port = 9000;
    g_args.loss_rate = 0.0;
    g_args.delay_ms = 0;
    g_args.reorder = 0;
    g_args.block_size = 1024;
    g_args.K = 4;
    g_args.redundancy = 2;
    strcpy(g_args.role, "all");

    static struct option long_options[] = {
        {"transfer-id", required_argument, 0, 't'},
        {"protocol",    required_argument, 0, 'p'},
        {"file",        required_argument, 0, 'f'},
        {"out",         required_argument, 0, 'o'},
        {"ip",          required_argument, 0, 'i'},
        {"port",        required_argument, 0, 'P'},
        {"loss",        required_argument, 0, 'l'},
        {"delay",       required_argument, 0, 'd'},
        {"reorder",     required_argument, 0, 'R'},
        {"block-size",  required_argument, 0, 'b'},
        {"k",           required_argument, 0, 'k'},
        {"redundancy",  required_argument, 0, 'r'},
        {"role",        required_argument, 0, 'm'},
        {0, 0, 0, 0}
    };

    int opt;
    while ((opt = getopt_long(argc, argv, "t:p:f:o:i:P:l:d:R:b:k:r:m:", long_options, NULL)) != -1) {
        switch (opt) {
            case 't': strncpy(g_args.transfer_id, optarg, sizeof(g_args.transfer_id)-1); break;
            case 'p': strncpy(g_args.protocol, optarg, sizeof(g_args.protocol)-1); break;
            case 'f': strncpy(g_args.file_path, optarg, sizeof(g_args.file_path)-1); break;
            case 'o': strncpy(g_args.out_path, optarg, sizeof(g_args.out_path)-1); break;
            case 'i': strncpy(g_args.ip, optarg, sizeof(g_args.ip)-1); break;
            case 'P': g_args.port = atoi(optarg); break;
            case 'l': g_args.loss_rate = atof(optarg) / 100.0; break;
            case 'd': g_args.delay_ms = atoi(optarg); break;
            case 'R': g_args.reorder = atoi(optarg); break;
            case 'b': g_args.block_size = atoi(optarg); break;
            case 'k': g_args.K = atoi(optarg); break;
            case 'r': g_args.redundancy = atoi(optarg); break;
            case 'm': strncpy(g_args.role, optarg, sizeof(g_args.role)-1); break;
            default: break;
        }
    }

    if (g_args.file_path[0] == '\0') {
        fprintf(stderr, "Error: --file argument is required\n");
        return 1;
    }
    if (g_args.out_path[0] == '\0') {
        snprintf(g_args.out_path, sizeof(g_args.out_path), "%s.reconstructed", g_args.file_path);
    }

    events_init(g_args.transfer_id);

    char orig_sha[65] = {0};
    size_t orig_sz = 0;
    compute_sha256_hex(g_args.file_path, orig_sha, &orig_sz);

    impairment_config_t impair;
    impairment_init(&impair, g_args.loss_rate, g_args.delay_ms, g_args.reorder != 0, 42);

    netcode_metrics_t metrics;
    metrics_init(&metrics, g_args.transfer_id, g_args.protocol, g_args.loss_rate, g_args.delay_ms, orig_sz, g_args.block_size, g_args.K);
    metrics_start(&metrics);

    thread_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));

    if (strcmp(g_args.role, "all") == 0) {
        /* Open UDP sockets */
        int rx_sock = socket(AF_INET, SOCK_DGRAM, 0);
        int tx_sock = socket(AF_INET, SOCK_DGRAM, 0);

        int opt_reuse = 1;
        setsockopt(rx_sock, SOL_SOCKET, SO_REUSEADDR, &opt_reuse, sizeof(opt_reuse));

        struct sockaddr_in rx_addr;
        memset(&rx_addr, 0, sizeof(rx_addr));
        rx_addr.sin_family = AF_INET;
        rx_addr.sin_port = htons(g_args.port);
        rx_addr.sin_addr.s_addr = htonl(INADDR_ANY);

        if (bind(rx_sock, (struct sockaddr *)&rx_addr, sizeof(rx_addr)) < 0) {
            perror("bind rx_sock");
            return 1;
        }

        ctx.rx_sock = rx_sock;
        ctx.tx_sock = tx_sock;
        ctx.orig_sz = orig_sz;
        ctx.metrics = &metrics;
        ctx.impair = &impair;

        pthread_t th_rx, th_tx;
        pthread_create(&th_rx, NULL, receiver_thread, &ctx);
        pthread_create(&th_tx, NULL, sender_thread, &ctx);

        pthread_join(th_tx, NULL);
        pthread_join(th_rx, NULL);

        close(rx_sock);
        close(tx_sock);
    }

    metrics_stop(&metrics);
    metrics_emit(&metrics);

    /* Verify file integrity */
    char recon_sha[65] = {0};
    size_t recon_sz = 0;
    compute_sha256_hex(g_args.out_path, recon_sha, &recon_sz);

    bool b_equal = compare_files_byte_for_byte(g_args.file_path, g_args.out_path);
    bool passed = (ctx.tx_res == 0 && ctx.rx_res == 0 && b_equal && (strcmp(orig_sha, recon_sha) == 0));

    event_emit_verification_result(passed, orig_sha, recon_sha, orig_sz, recon_sz);

    return passed ? 0 : 2;
}
