#ifndef NETCODE_IMPAIRMENT_H
#define NETCODE_IMPAIRMENT_H

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

typedef struct {
    double loss_rate;         /* 0.0 to 1.0 */
    uint32_t delay_ms;        /* Delay before forwarding */
    bool reorder;             /* Reorder flag */
    uint32_t seed;            /* Random seed */
    uint64_t prng_state;      /* Reproducible 64-bit PRNG state */
    
    bool has_buffered;
    uint8_t buffer[2048];
    size_t buffered_len;
} impairment_config_t;

void impairment_init(impairment_config_t *cfg, double loss_rate, uint32_t delay_ms, bool reorder, uint32_t seed);
void impairment_reset_seed(impairment_config_t *cfg, uint32_t seed);
bool impairment_should_drop(impairment_config_t *cfg);
void impairment_apply_delay(const impairment_config_t *cfg);

#endif /* NETCODE_IMPAIRMENT_H */
