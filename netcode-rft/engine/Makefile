CC = gcc
CFLAGS = -Wall -Wextra -O2 -std=c11 -Iinclude -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE
LDFLAGS = -pthread

SRCS = src/gf256.c src/sha256.c src/protocol.c src/impairment.c src/events.c src/metrics.c src/rlnc.c src/reliable_udp.c src/transfer.c
OBJS = $(SRCS:.c=.o)

all: bin/netcode_engine

bin/netcode_engine: src/main.o $(OBJS)
	@mkdir -p bin
	$(CC) $(CFLAGS) $^ -o $@ $(LDFLAGS)

bin/test_%: tests/test_%.o $(OBJS)
	@mkdir -p bin
	$(CC) $(CFLAGS) $^ -o $@ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

test: bin/test_gf256 bin/test_rlnc bin/test_protocol bin/test_reliable_udp bin/test_packet_loss bin/test_rudp_retransmission bin/test_file_integrity
	@echo "=== Running C Engine Unit Tests ==="
	./bin/test_gf256
	./bin/test_rlnc
	./bin/test_protocol
	./bin/test_reliable_udp
	./bin/test_packet_loss
	./bin/test_rudp_retransmission
	./bin/test_file_integrity
	@echo "=== All C Unit Tests Completed Successfully ==="

clean:
	rm -rf src/*.o tests/*.o bin

.PHONY: all test clean
