.PHONY: all setup build test test-live run clean

all: build

setup:
	bash scripts/setup.sh

build:
	bash scripts/build.sh

test:
	bash scripts/test.sh

test-live:
	bash scripts/test_live_transfers.sh

run:
	bash scripts/run.sh

clean:
	cd engine && make clean
	rm -rf uploads/* downloads/* storage/rlnc_* storage/rudp_* storage/benchmark_*
