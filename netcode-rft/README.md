# NetCode-RFT — Loss-Resilient File Transfer over UDP using Network Coding

NetCode-RFT is a computer networking application demonstrating reliable file transfer over POSIX UDP sockets. It benchmarks **Random Linear Network Coding (RLNC)** over Galois Field **GF(256)** against a **Reliable UDP (Stop-and-Wait ARQ)** baseline under controlled network impairments.

The application couples a **C11 POSIX networking engine**, an **Express/Socket.IO Node.js supervision backend**, and a **React dashboard** designed directly after the reference engineering specification.

---

## 📸 Two-Screen Architecture

### Screen 1: Transfer & Simulation (`/`)
An operational network engineering dashboard structured into three upper panels and a comparative results table:
1. **Left Panel — File Upload & Simulation Settings**:
   - File picker supporting arbitrary binaries and one-click **⚡ Load Sample File (256 KB / 4 KB Demo)**.
   - Channel impairment controls: Packet Loss Rate (0%, 5%, 10%, 20%, 30%).
   - Protocol selector: **Network Coding (RLNC)** vs. **Reliable UDP (ACK + Retransmission)**.
   - Action button: **Start Transfer**.
2. **Center Panel — UDP Conduit & Packet Transmission**:
   - **UDP Connection (Three-Way Handshake)**: Visualizes genuine application-level UDP exchange:
     - `1. SYN (Request)`: Sender $\rightarrow$ Receiver
     - `2. SYN-ACK (Response)`: Receiver $\rightarrow$ Sender
     - `3. ACK (Confirmation)`: Sender $\rightarrow$ Receiver
   - **Packet Transmission**: Real-time packet cards displaying transmission lifecycle:
     - Outgoing datagrams: `P1 (Send)`, `P2 (Send)`
     - Impairment drops: `P3 (Lost ✕)` (marked with red loss indicator)
     - Receiver arrivals: `P6 (Received)` (marked with green receipt badge)
3. **Right Panel — Transfer Progress & Receiver Status**:
   - **Transfer Progress**: Active progress bar (100%), completion status, total generated packets, sent, lost, received, transfer time, and throughput.
   - **File at Receiver**: Receiver file card, **Verify File (SHA-256)** button, status indicator, and direct download endpoint.
4. **Bottom Full-Width Panel — Performance Comparison**:
   - Comparative table contrasting RLNC against Reliable UDP across:
     - File Recovery Success
     - Transfer Duration (s)
     - Measured Throughput (KB/s)
     - Retransmission Count
     - Additional Data Transmitted (KB)
     - Decoding Computation Time (s)

---

### Screen 2: Equation Lab (`/equations`)
Provides an educational mathematical breakdown of the selected transfer through six sequential steps:
1. **❶ Received Coded Packets**: Generation breakdown ($k=3$ / $k=4$), coefficient vectors $[c_1, c_2, c_3]$, and payload bytes.
2. **❷ Coefficient Matrix (A) & Coded Data Matrix (C)**:
   - Full coefficient matrix $A$ in mathematical bracket notation:
     $$A = \begin{bmatrix} 1 & 0 & 2 \\ 0 & 1 & 3 \\ 1 & 1 & 1 \\ 2 & 1 & 0 \end{bmatrix}$$
   - Matrix rank indicator ($\text{Rank} = k$, `Full Rank ✔`).
   - Coded payload matrix $C$.
3. **❸ Gaussian Elimination (GF(256))**:
   - Augmented system $[A \mid C]$.
   - Step 1: Row transformations with finite-field arithmetic ($R_3 \leftarrow R_3 + R_1$, $R_4 \leftarrow R_4 + 2R_1$).
   - Step 2: Pivot normalization and column elimination.
   - Resulting inverse matrix $A^{-1}$.
4. **❹ Decode Source Packets**:
   - Finite-field matrix product: $X = A^{-1} \times C \pmod{\text{GF}(256)}$.
   - Recovered source blocks $P_1, P_2, P_3$.
5. **❺ Reconstruct File**:
   - Reassembly progress bar (100%) and block concatenation.
6. **❻ SHA-256 Verification**:
   - Original file cryptographic digest vs. receiver output digest.
   - Status badge: `Hashes match! File is identical. ✔`.

---

## ⚙️ Technical Specifications & Implementation Details

### 1. Finite Field Arithmetic (GF(256))
- **Field Size**: $2^8 = 256$ elements.
- **Irreducible Primitive Polynomial**:
  $$P(x) = x^8 + x^4 + x^3 + x^2 + 1 \quad (\text{Hex: } \texttt{0x11D})$$
- **Primitive Generator Element**: $g = 0\text{x}02$.
- **Arithmetic Architecture**:
  - Addition / Subtraction: Bitwise XOR ($\oplus$).
  - Multiplication / Inversion: 256-byte precomputed logarithm and antilogarithm lookup tables (`gf256_mul`, `gf256_inv`).
  - Self-identity: For all $a \in \text{GF}(256) \setminus \{0\}$, $a \otimes a^{-1} = 1$.

### 2. Random Linear Network Coding (RLNC)
- Source files are partitioned into $N = \lceil S / B \rceil$ blocks of size $B$ (default 1024 bytes).
- Blocks are grouped into generations of size $K$ (default $K=4$).
- For each generation $g$, the sender transmits:
  1. **Systematic Packets**: Unit vectors $e_i$ ($i \in [0, K-1]$).
  2. **Coded Redundancy Packets**: Linear combinations $Y = \sum_{i=1}^K c_i B_i$, where $c_i \xleftarrow{\text{R}} \text{GF}(256)$.
- The receiver maintains a local decoding matrix $A$ and performs progressive Gauss-Jordan elimination on innovative packets. Once $\text{rank}(A) = K$, full recovery is achieved and written to the output file.

### 3. Reliable UDP Baseline
- Stop-and-Wait ARQ implementation over UDP sockets.
- Sequence-numbered datagrams (`PKT_TYPE_DATA_RUDP`), explicit ACK datagrams (`PKT_TYPE_ACK`).
- Timeout-driven retransmissions (default 100ms) with bounded retry budgets ($R_{\max} = 10$).

### 4. Integrity Verification & Negative Testing
- **Receiver-Side Output**: Output files are written to `<filename>_received_RLNC.<ext>` or `<filename>_received_RUDP.<ext>`. The original file is **never** copied directly.
- **Cryptographic Hash**: SHA-256 digests are computed independently from disk for both original and reconstructed files.
- **Negative Testing Scenarios**:
  - Premature transfer cancellation: Reports `CANCELLED`.
  - Bit flip in reconstructed file: Reports `FAILED` (SHA-256 mismatch).
  - Truncated reconstructed file: Reports `FAILED` (size mismatch).
  - High loss exceeding packet budget: Reports `FAILED` (insufficient rank).

---

## 🛠️ Project Structure

```
netcode-rft/
├── engine/                   # C11 Networking Engine
│   ├── include/              # Headers (gf256.h, rlnc.h, protocol.h, events.h, metrics.h)
│   ├── src/                  # Source files (main.c, gf256.c, rlnc.c, transfer.c, reliable_udp.c)
│   ├── tests/                # C Unit tests (test_gf256.c, test_rlnc.c, test_reliable_udp.c)
│   └── Makefile              # Engine build rules
├── backend/                  # Node.js LTS Supervision Backend
│   ├── src/                  # Express app, Socket.IO, EngineManager, routes, services
│   ├── tests/                # Automated API, calculation, and negative corruption tests
│   └── package.json
├── ui/                       # React + Vite Frontend
│   ├── src/
│   │   ├── components/       # HandshakePanel, PacketTransmissionPanel, PerformanceTable...
│   │   ├── screens/          # NetworkSimulationScreen.jsx, EquationLabScreen.jsx
│   │   ├── context/          # TransferContext.jsx (Socket.IO event bus & state machine)
│   │   └── styles/           # index.css (Dark navy aesthetic)
│   └── package.json
└── package.json              # Root orchestration
```

---

## 🚀 Build, Test, and Run Instructions

### Prerequisites
- GCC / C11 compiler (`gcc`, `make`, `pthread`).
- Node.js LTS (v18+ or v20+) and `npm`.
- Linux, Ubuntu, or Windows with WSL2.

### 1. Build the Entire System
```bash
# Build C engine binary and frontend bundle
npm run build
```

### 2. Run All Automated Test Suites
```bash
# Run C engine unit tests, Protocol tests, GF(256) tests, and RUDP tests
wsl bash -c "cd /mnt/f/CN_project/netcode-rft/engine && make test"

# Run backend unit tests and negative corruption test suite
cd backend && npm test
```

### 3. Run Live End-to-End Transfer Test
```bash
# Tests real UDP socket file transfer, impairment drop, reconstruction, and SHA-256 match
cd backend && node tests/live_e2e_verify.js
```

### 4. Launch the Full Application
```bash
# Terminal 1: Start Backend Server (port 5000)
cd backend && node src/server.js

# Terminal 2: Start Frontend Dev Server (port 3000)
cd ui && npm run dev
```

* Open your browser at **`http://localhost:3000`** to access the dashboard.
* Backend API health status: **`http://localhost:5000/api/health`**.

---

## 📄 License & Attribution
Academic and research implementation of Network Coding Based Loss-Resilient File Transfer over UDP. Antigravity Systems.
