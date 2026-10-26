# Legacy NS-3 Simulator Retirement Notice

## Overview
All networking engine and simulation logic in `NetCode-RFT` has been completely refactored from legacy C++ / NS-3 into **pure C (C11)**.

### Why Legacy C++ Files Were Removed
1. **Zero C++ and NS-3 Dependency**: Requirement 1 mandates using C11 for all networking and simulation logic without C++ files, classes, templates, or NS-3 C++ APIs.
2. **True Protocol Execution**: Rather than simulating packets inside an abstract discrete-event simulator loop (`ns3::Simulator::Run()`), the C11 engine executes live UDP socket communication (`socket(AF_INET, SOCK_DGRAM, 0)`, `sendto`, `recvfrom`, POSIX threads).
3. **Pure C11 Implementation Equivalents**:
   - `gf256.cc` / `gf256.h` (C++ class `netcode::Gf256`) &rarr; Rewritten in `engine/src/gf256.c` & `engine/include/gf256.h` with primitive polynomial `0x11D`.
   - `netcode-headers.cc` / `netcode-headers.h` (C++ `ns3::Header` inheritance) &rarr; Rewritten in `engine/src/protocol.c` & `engine/include/protocol.h`.
   - `rlnc-application.cc` / `rlnc-application.h` (C++ `ns3::Application`, `std::vector`) &rarr; Rewritten in `engine/src/rlnc.c`, `engine/src/transfer.c`, `engine/include/rlnc.h`, `engine/include/transfer.h`.
   - `rudp-application.cc` / `rudp-application.h` (C++ `ns3::Application`, `std::vector`) &rarr; Rewritten in `engine/src/reliable_udp.c`, `engine/include/reliable_udp.h`.
   - `sha256.cc` / `sha256.h` (C++ class `SHA256`) &rarr; Rewritten in `engine/src/sha256.c` & `engine/include/sha256.h`.
   - `main-simulation.cc` (C++ main with `ns3::PointToPointHelper`, `ns3::RateErrorModel`, `ns3::AnimationInterface`) &rarr; Rewritten in `engine/src/main.c`, `engine/src/impairment.c`, `engine/src/events.c`, `engine/src/metrics.c`.
4. **NetAnim Replacement**: NetAnim (which required external Qt libraries and NS-3 XML output) is replaced by the interactive in-UI **Network Packet & Channel Telemetry Visualizer** (`ui/src/screens/NetworkVisualizerScreen.jsx`), powered by authentic real-time telemetry emitted by the C11 engine.
