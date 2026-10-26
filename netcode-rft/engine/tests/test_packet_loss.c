#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <math.h>
#include "impairment.h"

int main(void) {
    printf("Running Packet Loss & Seed Reproducibility Unit Tests...\n");

    /* 1. Test 0% loss: MUST never drop */
    impairment_config_t cfg_zero;
    impairment_init(&cfg_zero, 0.0, 0, false, 42);
    for (int i = 0; i < 1000; i++) {
        assert(impairment_should_drop(&cfg_zero) == false);
    }
    printf("  [Packet Loss] 0%% loss rate verified (0/1000 dropped).\n");

    /* 2. Test 100% loss: MUST drop every packet */
    impairment_config_t cfg_full;
    impairment_init(&cfg_full, 1.0, 0, false, 42);
    for (int i = 0; i < 1000; i++) {
        assert(impairment_should_drop(&cfg_full) == true);
    }
    printf("  [Packet Loss] 100%% loss rate verified (1000/1000 dropped).\n");

    /* 3. Test Seed Reproducibility: Same seed must produce identical drop sequence */
    impairment_config_t cfg_seed_a, cfg_seed_b;
    impairment_init(&cfg_seed_a, 0.25, 0, false, 99999);
    impairment_init(&cfg_seed_b, 0.25, 0, false, 99999);

    bool seq_a[500];
    bool seq_b[500];
    for (int i = 0; i < 500; i++) {
        seq_a[i] = impairment_should_drop(&cfg_seed_a);
        seq_b[i] = impairment_should_drop(&cfg_seed_b);
        assert(seq_a[i] == seq_b[i]);
    }
    printf("  [Packet Loss] Seed reproducibility verified (500 identical decisions for seed=99999).\n");

    /* 4. Test Different Seeds Produce Different Sequences */
    impairment_config_t cfg_seed_c;
    impairment_init(&cfg_seed_c, 0.25, 0, false, 12345);
    int differences = 0;
    for (int i = 0; i < 500; i++) {
        bool drop_c = impairment_should_drop(&cfg_seed_c);
        if (drop_c != seq_a[i]) {
            differences++;
        }
    }
    assert(differences > 50); /* Statistically very different */
    printf("  [Packet Loss] Seed independence verified (%d differences between seeds 99999 and 12345).\n", differences);

    /* 5. Statistical Loss Rate Validation: 20% loss across 10,000 samples */
    impairment_config_t cfg_stat;
    impairment_init(&cfg_stat, 0.20, 0, false, 7777);
    int drops = 0;
    const int SAMPLES = 10000;
    for (int i = 0; i < SAMPLES; i++) {
        if (impairment_should_drop(&cfg_stat)) {
            drops++;
        }
    }
    double observed_rate = (double)drops / (double)SAMPLES;
    printf("  [Packet Loss] Configured 20.0%% loss -> Observed %.2f%% (%d/%d drops)\n",
           observed_rate * 100.0, drops, SAMPLES);
    /* Within 2% margin for 10k samples */
    assert(fabs(observed_rate - 0.20) < 0.02);

    /* 6. Test Seed Reset */
    impairment_reset_seed(&cfg_seed_a, 99999);
    for (int i = 0; i < 500; i++) {
        assert(impairment_should_drop(&cfg_seed_a) == seq_a[i]);
    }
    printf("  [Packet Loss] Seed reset verified (reproduces original sequence exactly).\n");

    printf("ALL PACKET LOSS & REPRODUCIBILITY TESTS PASSED!\n");
    return 0;
}
