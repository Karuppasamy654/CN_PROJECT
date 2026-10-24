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

void impairment_init(impairment_config_t *cfg, double loss_rate, uint32_t delay_ms, bool reorder, uint32_t seed) {
    cfg->loss_rate = loss_rate;
    cfg->delay_ms = delay_ms;
    cfg->reorder = reorder;
    cfg->seed = seed;
    cfg->has_buffered = false;
    cfg->buffered_len = 0;

    if (seed == 0) {
        srand((unsigned int)time(NULL));
    } else {
        srand(seed);
    }
}

bool impairment_should_drop(impairment_config_t *cfg) {
    if (cfg->loss_rate <= 0.0) return false;
    if (cfg->loss_rate >= 1.0) return true;
    double r = (double)rand() / (double)RAND_MAX;
    return r < cfg->loss_rate;
}

void impairment_apply_delay(const impairment_config_t *cfg) {
    if (cfg->delay_ms > 0) {
        usleep(cfg->delay_ms * 1000);
    }
}
