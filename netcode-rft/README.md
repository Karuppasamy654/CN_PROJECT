# NetCode-RFT: NS-3 & C11 Simulation Platform with NetAnim Integration

**NetCode-RFT** is a comprehensive computer networking and error-control research platform featuring **NS-3 (v3.41) discrete-event simulation**, **NetAnim (v3.109) desktop animation**, a **native C (C11) networking engine**, **finite field arithmetic GF(256)**, **Random Linear Network Coding (RLNC)**, **Stop-and-Wait Reliable UDP (RUDP)**, a **Node.js process supervisor**, and an **interactive React engineering dashboard**.

The platform benchmarks, analyzes, and visualizes two contrasting transport strategies over real Point-to-Point links and UDP network sockets subject to configurable impairment (physical packet loss, propagation delay, and reproducible random seeds):

1. **Random Linear Network Coding (RLNC)**: Forward Error Correction (FEC) over Galois Field **GF(256)** using primitive polynomial `0x11D` and generator `0x02`. Transfers systematic source packets followed by linear combination repair packets, decoded on-the-fly via progressive Gaussian elimination.
2. **Reliable UDP (RUDP)**: Stop-and-Wait Automatic Repeat reQuest (**ARQ**) with sequence numbering, acknowledgment packets (ACKs), retransmission timeouts, and duplicate packet detection.

### 🎯 Faculty & Mentor Demonstration Ready
* **NS-3 Network Simulation**: Built on `/home/muthu/ns-allinone-3.41/ns-3.41` with genuine `PointToPointHelper`, `RateErrorModel`, `PhyRxDrop` sinks, and `AnimationInterface`.
* **NetAnim Desktop Animator**: Installed at `/usr/local/bin/netanim`. Loads generated XML traces with Node 0 (Sender) and Node 1 (Receiver), packet movement, and drop statistics.
* **Pure C11 Engine**: Native BSD UDP socket transfer engine (`engine/bin/netcode_engine`) compiled with `-std=c11 -Wall -Wextra -O2 -pthread`.
* **Full-Stack Dashboard**: Web UI at `http://localhost:3000` with one-click NetAnim launching, live telemetry streaming, Equation Lab, and cryptographic SHA-256 integrity verification.

---

## 🏛️ System Architecture

```
                       +-------------------------------------------------+
                       |             React Dashboard (Vite)              |
                       |  Controls • Telemetry Visualizer • Equation Lab |
                       +------------------------+------------------------+
                                                | HTTP / Socket.IO
                                                v
                       +-------------------------------------------------+
                       |           Node.js Supervisor Backend            |
                       | Process Manager • Stream Parser • Hash Verifier |
                       +------------------------+------------------------+
                                                | Spawns & Streams EVENT_JSON / METRICS_JSON
                                                v
     +----------------------------------------------------------------------------------------+
     |                              C11 Networking Engine (GCC)                              |
     |  Node 0 (Sender) <========== BSD UDP Sockets (127.0.0.1:Port) ==========> Node 1 (Recv)|
     |                                                                                        |
     |  [RLNC Protocol Engine]                                 [RUDP Protocol Engine]         |
     |  • GF(256) Arithmetic (Poly 0x11D)                      • Sequence Numbers             |
     |  • Systematic Vectors [1 0 0 0]                         • Stop-and-Wait ARQ Timers     |
     |  • Coded Repair Packets sum(c_i * B_i)                  • ACK Generation & Validation  |
     |  • Progressive Gaussian Elimination                     • Retransmissions & Timeout    |
     |  • Matrix Rank Tracking (rank = K)                      • Duplicate Packet Detection   |
     |                                                                                        |
     |  [Channel Impairment Layer]                             [Integrity & Verification]     |
     |  • Deterministic 64-bit PRNG Seed                       • NIST SHA-256 Checksums       |
     |  • Configurable Packet Loss (0-90%)                     • Byte-for-byte File Compare   |
     |  • Simulated Link Latency & Reorder                     • Accurate Goodput Accounting  |
     +----------------------------------------------------------------------------------------+
```

---

## 🔬 Core Components & Capabilities

### 1. Pure C (C11) Networking & Protocol Engine
* **Language Standard**: Strict **ISO C11** (`-std=c11 -Wall -Wextra -O2`). Zero C++ files, classes, templates, or external simulation frameworks.
* **Socket Architecture**: Standard BSD/POSIX UDP sockets (`socket(AF_INET, SOCK_DGRAM, 0)`, `bind`, `sendto`, `recvfrom`, `setsockopt`).
* **Concurrency**: POSIX threads (`pthread`) for simultaneous sender and receiver loopback execution, or standalone CLI roles (`--role all`, `--role sender`, `--role receiver`).
* **Binary Packaging**: Compact custom protocol header (`netcode_header_t`) with magic bytes `['N', 'C']`, protocol version, packet type, sequence ID, generation ID, block ID, payload length, and payload CRC32.

### 2. GF(256) Finite Field Arithmetic
* **Field Representation**: Galois Field $GF(2^8) = GF(256)$.
* **Primitive Polynomial**: $P(x) = x^8 + x^4 + x^3 + x^2 + 1$ (`0x11D`).
* **Generator Element**: $g = 0\text{x}02$.
* **Fast Computation**: Precomputed exponent and logarithm lookup tables for $O(1)$ multiplication, division, and multiplicative inverses ($a \cdot a^{-1} = 1$).
* **Verification**: Bitwise Russian Peasant reference calculation to mathematically verify all $256 \times 256$ multiplication combinations.
* **Vector Accelerators**: Row multiplication (`gf256_row_mul`) and row multiply-accumulate (`gf256_row_madd`) for augmented matrix operations.

### 3. Genuine Random Linear Network Coding (RLNC)
* **Generations**: File split into generations of size $K$ blocks (configurable $K \in [1, 32]$).
* **Systematic Packets**: First $K$ packets contain original source blocks and canonical unit coefficient vectors ($e_i$).
* **Coded Repair Packets**: Redundancy packets carry random coefficient vectors $[c_0, c_1, \dots, c_{K-1}] \in GF(256)^K$ and linear combinations $P = \sum_{i=0}^{K-1} c_i \cdot B_i$.
* **On-the-Fly Gaussian Elimination**: Receiver maintains an augmented matrix $[A \mid C]$. Each arriving packet is eliminated against existing pivot rows. If innovative, it normalizes to unit leading coefficient and back-substitutes against previous rows.
* **Rank Completion**: Reconstructs original source blocks as soon as $\text{rank}(A) = K$, without needing retransmissions for lost systematic packets if sufficient coded repair packets arrive.

### 4. Stop-and-Wait Reliable UDP (RUDP) Baseline
* **Sequencing**: Monotonically increasing sequence IDs on every data packet.
* **ARQ Reliability**: Sender sends packet and waits for matching ACK with configurable timeout (`RUDP_TIMEOUT_MS = 200ms`).
* **Duplicate Detection**: Receiver discards duplicate packets while re-emitting ACKs to resolve reverse ACK loss.
* **Graceful Termination**: Three-way application handshake and FIN/FIN-ACK connection closure.

### 5. Impairment Simulation & Reproducible Seeds
* **Loss Model**: Per-packet drop decision based on configured loss rate ($0.0$ to $1.0$).
* **Reproducibility**: Per-instance 64-bit SplitMix64 pseudo-random number generator initialized from `--seed <val>`. Two runs with the same seed generate 100% identical packet drop patterns.
* **Delay & Reorder**: Link propagation latency simulation via microsecond timers and packet hold buffering.

### 6. Cryptographic Integrity Verification
* **SHA-256 Engine**: NIST-compliant SHA-256 hash algorithm implemented in C11 (`sha256.c`).
* **Byte-for-Byte Comparison**: Exact byte comparison (`compare_files_byte_for_byte`) between source file and reconstructed destination file.
* **Verification Gating**: Downloads and success badges are strictly blocked if size or SHA-256 hashes mismatch.

### 7. Native in-UI Telemetry & Channel Visualizer
* **Interactive Timeline**: Replaces deprecated external NetAnim with an interactive React visualizer (`/visualizer`).
* **Visual States**: Packet badges in flight showing Seq ID, Gen ID, Type, and status (Transmitted, In Flight, Dropped, Delivered, ACK).
* **Rank Progression**: Real-time augmented matrix rank evolution display ($r/K$).
* **Playback Controls**: Play, Pause, Step Forward, Step Backward, Restart, and Speed controls (0.5x, 1x, 2x, 4x).

---

## 📁 Repository Directory Structure

```
netcode-rft/
├── engine/                           # Pure C (C11) Networking Engine
│   ├── include/
│   │   ├── events.h                  # Real-time JSON event telemetry declarations
│   │   ├── gf256.h                   # GF(256) finite field arithmetic & poly 0x11D
│   │   ├── impairment.h              # Channel impairment & reproducible PRNG seeds
│   │   ├── metrics.h                 # Throughput, goodput & packet accounting
│   │   ├── protocol.h                # Protocol packet header & CRC32 definitions
│   │   ├── reliable_udp.h            # Stop-and-Wait RUDP ARQ interface
│   │   ├── rlnc.h                    # RLNC encoder/decoder & Gaussian elimination
│   │   ├── sha256.h                  # Cryptographic SHA-256 verification
│   │   └── transfer.h                # UDP file transfer routines
│   ├── src/                          # C11 implementation source files (.c)
│   ├── tests/                        # Automated unit tests in C
│   │   ├── test_gf256.c              # GF(256) field arithmetic verification
│   │   ├── test_protocol.c           # Packet serialization & CRC32 tests
│   │   ├── test_rlnc.c               # Deterministic RLNC & Gaussian elimination tests
│   │   ├── test_reliable_udp.c       # Stop-and-Wait ACK & SHA-256 NIST tests
│   │   ├── test_packet_loss.c        # Configurable packet loss & seed reproducibility
│   │   ├── test_rudp_retransmission.c# RUDP timeout, retransmission & duplicate filter
│   │   └── test_file_integrity.c     # SHA-256 file hashing & corruption detection
│   └── Makefile                      # GCC build configuration (-std=c11 -pthread)
├── backend/                          # Node.js Express & Socket.IO Supervisor
│   ├── src/
│   │   ├── config.js                 # Engine binary paths and storage configuration
│   │   ├── routes/                   # REST API routes (transfers, calculations, health)
│   │   ├── services/                 # Engine process manager, store, calculations
│   │   └── server.js                 # Server entry point (port 5000)
│   └── tests/                        # 65 automated backend tests (node --test)
├── ui/                               # React 18 + Vite Engineering Dashboard
│   ├── src/
│   │   ├── screens/                  # Simulation, Visualizer, Comparison, History, Equation Lab
│   │   │   ├── NetworkSimulationScreen.jsx
│   │   │   ├── NetworkVisualizerScreen.jsx  # Replaces legacy NetAnim with real telemetry
│   │   │   ├── RlncVsRudpComparisonScreen.jsx
│   │   │   ├── ExperimentHistoryScreen.jsx
│   │   │   └── EquationLabScreen.jsx
│   │   └── App.jsx                   # Route configuration
│   └── package.json
├── scripts/                          # Automation, test, and verification scripts
│   ├── build.sh                      # Full project build script
│   ├── test.sh                       # Multi-suite automated test orchestrator
│   ├── test_live_transfers.sh        # 10 live UDP transfers across 0-30% loss
│   ├── test_ns3_integration.js       # End-to-end C engine integration verification
│   └── run.sh                        # Service launcher
├── storage/                          # Test payloads and reconstructed outputs
├── uploads/                          # User-uploaded files
├── Makefile                          # Top-level make targets (build, test, run, clean)
└── README.md                         # Documentation
```

---

## 🛠️ Build and Run Instructions

### Prerequisites
* **Compiler**: GCC with C11 and pthread support (available on Ubuntu 20.04+, Debian, WSL2, or MSYS2).
* **Runtime**: Node.js v18+ and npm.
* **Platform**: Linux, Ubuntu on WSL2 (Windows Subsystem for Linux), or MSYS2.

### 1. Build the Complete Project
To compile the C engine and bundle the frontend:
```bash
# Via top-level Makefile
make build

# Or directly via bash script
bash scripts/build.sh
```

To compile only the C engine:
```bash
cd engine
make clean all
```
Executable produced: `engine/bin/netcode_engine`.

### 2. Run All Automated Test Suites
Run all tests across all layers (C engine unit tests, backend test suites, and 10 live UDP transfers):
```bash
make test
```
Or run individual test suites:

#### A. C Engine Unit Tests (7 test suites)
```bash
cd engine
make test
```
Outputs:
- `bin/test_gf256`: Galois field operations, bitwise multiplication, inverses.
- `bin/test_rlnc`: Systematic encoding, coded combinations, Gaussian elimination.
- `bin/test_protocol`: Packet serialization, deserialization, CRC32, corruption detection.
- `bin/test_reliable_udp`: Stop-and-Wait ACK packets and NIST SHA-256 test vectors.
- `bin/test_packet_loss`: Configurable loss rates (0-100%) and seed reproducibility.
- `bin/test_rudp_retransmission`: ARQ timeouts, retransmissions, duplicate filtering.
- `bin/test_file_integrity`: SHA-256 hashing, corruption detection, size verification.

#### B. Backend API & Invariant Tests (65 test scenarios)
```bash
cd backend
npm test
```

#### C. Live UDP Impairment Transfers (10 experiments)
```bash
bash scripts/test_live_transfers.sh
```
Executes 10 genuine UDP transfers (RLNC and RUDP at 0%, 5%, 10%, 20%, 30% packet loss) over loopback sockets, verifying byte-exact reconstructed file equality and matching SHA-256 checksums.

#### D. End-to-End Engine Socket Integration
```bash
node scripts/test_ns3_integration.js
```

#### E. NS-3 Simulation & NetAnim Trace Generation
```bash
# 1. Sync and build the NS-3 simulation executable
bash scripts/build_ns3.sh

# 2. Run RLNC transfer under NS-3 with NetAnim XML output
wsl /home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default \
  --protocol=RLNC --loss=10 --seed=42 \
  --file=/mnt/f/CN_project/netcode-rft/storage/benchmark_input.bin \
  --out=/tmp/ns3_rlnc_out.bin \
  --trace=/mnt/f/CN_project/netcode-rft/results/ns3_rlnc_trace.xml

# 3. Launch official NetAnim 3.109 desktop viewer (via WSLg)
wsl bash -lc "DISPLAY=:0 /usr/local/bin/netanim /mnt/f/CN_project/netcode-rft/results/ns3_rlnc_trace.xml"
```

### 3. Run the Full Application (Dashboard + Backend)
```bash
make run
```
Or start services independently:
```bash
# Terminal 1: Backend API (port 5000)
cd backend && npm start

# Terminal 2: React Dashboard (port 3000)
cd ui && npm run dev
```
Open **http://localhost:3000** in your browser.

---

## 💻 CLI Usage for the C Networking Engine

The engine binary can be executed directly from the command line:

```bash
./engine/bin/netcode_engine [OPTIONS]
```

### Command Line Options:
| Flag | Long Option | Description | Default |
|------|-------------|-------------|---------|
| `-f` | `--file` | Path to input file to transmit (**required**) | — |
| `-o` | `--out` | Path to write reconstructed output file | `<file>.reconstructed` |
| `-p` | `--protocol` | Transfer protocol: `rlnc` or `rudp` | `rlnc` |
| `-l` | `--loss` | Packet loss rate in percent (e.g. `10` for 10%) | `0` |
| `-d` | `--delay` | Link propagation delay in milliseconds | `0` |
| `-R` | `--reorder` | Enable packet reordering emulation (`1` or `0`) | `0` |
| `-b` | `--block-size` | Payload size per block in bytes (64-1024) | `1024` |
| `-k` | `--k` | Generation size $K$ for RLNC (1-32) | `4` |
| `-r` | `--redundancy` | Number of coded repair packets per generation | `2` |
| `-s` | `--seed` | Random seed for PRNG and impairment reproducibility | `1` |
| `-i` | `--ip` | Destination IP address | `127.0.0.1` |
| `-P` | `--port` | UDP listening port | `9000` |
| `-m` | `--role` | Execution mode: `all`, `sender`, or `receiver` | `all` |
| `-t` | `--transfer-id` | Transfer tracking identifier | `transfer-001` |

### Example CLI Transfers:
```bash
# 1. RLNC transfer with 20% packet loss and reproducible seed 42
./engine/bin/netcode_engine --protocol rlnc --file input.bin --out output.bin --loss 20 --seed 42

# 2. Stop-and-Wait RUDP transfer with 10% packet loss and 15ms latency
./engine/bin/netcode_engine --protocol rudp --file input.bin --out output.bin --loss 10 --delay 15

# 3. Two-process standalone execution:
# Terminal 1 (Receiver):
./engine/bin/netcode_engine --protocol rlnc --file input.bin --out output.bin --port 9000 --role receiver

# Terminal 2 (Sender):
./engine/bin/netcode_engine --protocol rlnc --file input.bin --port 9000 --role sender
```

---

## 📊 Implemented vs. Planned Features

| Feature | Status | Implementation Details |
|---------|--------|------------------------|
| **C11 Networking Engine** | **Implemented** | Strict C11 code in `engine/`, compiled with GCC on WSL/Linux |
| **BSD UDP Sockets** | **Implemented** | Non-simulated real socket communication via `sendto`/`recvfrom` |
| **GF(256) Arithmetic** | **Implemented** | Poly `0x11D`, generator `0x02`, log/exp tables, Russian Peasant verification |
| **RLNC Coding** | **Implemented** | Systematic identity packets, random coded repair packets, coefficient vectors |
| **Gaussian Elimination** | **Implemented** | Progressive forward elimination, pivot normalization, back-substitution |
| **Stop-and-Wait RUDP** | **Implemented** | Monotonic sequence IDs, ACK validation, retransmission timeouts, duplicate filters |
| **Configurable Impairment** | **Implemented** | 0-90% loss rate, reproducible SplitMix64 seeds, delay emulation |
| **SHA-256 Verification** | **Implemented** | NIST SHA-256 hash checks and byte-for-byte comparisons |
| **Telemetry Streaming** | **Implemented** | Real-time `EVENT_JSON` and `METRICS_JSON` stdout streaming to Node.js & Socket.IO |
| **In-UI Visualizer** | **Implemented** | Interactive timeline, step-through, packet flight animations, rank display |
| **Automated Tests** | **Implemented** | 7 C unit tests, 65 Node.js tests, 10 live UDP transfers, integration test |
| **Sliding Window ARQ (Selective Repeat)** | *Planned* | Pipeline windowing baseline to compare against Stop-and-Wait ARQ |
| **Multi-Hop Network Coding** | *Planned* | Re-encoding at intermediate relay nodes (butterfly topology) |
| **SIMD AVX-512 GF(256)** | *Planned* | Vectorized Galois field matrix operations for gigabit throughput |
