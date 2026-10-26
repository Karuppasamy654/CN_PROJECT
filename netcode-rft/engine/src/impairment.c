#ifndef _DEFAULT_SOURCE
#define _DEFAULT_SOURCE
#endif
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#include "impairment.h"
#include <stdlib.h>
#include <unistd.h>
#include <time.h>

static uint64_t splitmix64(uint64_t *state) {
    uint64_t z = (*state += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}

void impairment_reset_seed(impairment_config_t *cfg, uint32_t seed) {
    cfg->seed = seed;
    uint64_t s = (seed == 0) ? (uint64_t)time(NULL) : (uint64_t)seed;
    cfg->prng_state = (s == 0) ? 0x853c49e65d6f8301ULL : s;
    /* Warm up PRNG */
    splitmix64(&cfg->prng_state);
}

void impairment_init(impairment_config_t *cfg, double loss_rate, uint32_t delay_ms, bool reorder, uint32_t seed) {
    cfg->loss_rate = loss_rate;
    cfg->delay_ms = delay_ms;
    cfg->reorder = reorder;
    cfg->has_buffered = false;
    cfg->buffered_len = 0;
    impairment_reset_seed(cfg, seed);
}

bool impairment_should_drop(impairment_config_t *cfg) {
    if (cfg->loss_rate <= 0.0) return false;
    if (cfg->loss_rate >= 1.0) return true;
    uint64_t r_val = splitmix64(&cfg->prng_state);
    double r = (double)(r_val >> 11) * (1.0 / 9007199254740992.0); /* [0, 1) standard 53-bit float */
    return r < cfg->loss_rate;
}

void impairment_apply_delay(const impairment_config_t *cfg) {
    if (cfg->delay_ms > 0) {
        usleep(cfg->delay_ms * 1000);
    }
}
