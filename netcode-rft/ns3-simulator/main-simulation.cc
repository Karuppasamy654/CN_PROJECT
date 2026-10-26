#include "ns3/core-module.h"
#include "ns3/network-module.h"
#include "ns3/internet-module.h"
#include "ns3/point-to-point-module.h"
#include "ns3/netanim-module.h"

#include "gf256.h"
#include "sha256.h"
#include "netcode-headers.h"
#include "rudp-application.h"
#include "rlnc-application.h"

#include <iostream>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <vector>
#include <cstdlib>
#include <filesystem>

using namespace ns3;
using namespace netcode;

NS_LOG_COMPONENT_DEFINE("NetcodeRftMainSimulation");

// Static drop sinks for NetDevice PhyRxDrop
static uint32_t g_forwardPhyDrops = 0;
static uint32_t g_reversePhyDrops = 0;
static uint32_t g_simTransferId = 1;

static void ForwardPhyDropSink(Ptr<const Packet> p) {
    g_forwardPhyDrops++;
    double nowSec = ns3::Simulator::Now().GetSeconds();
    uint32_t seq = 0;
    try {
        Ptr<Packet> copy = p->Copy();
        if (copy->GetSize() >= 30) {
            copy->RemoveAtStart(2); // Skip PPP 2 bytes
            Ipv4Header ip;
            copy->RemoveHeader(ip);
            UdpHeader udp;
            copy->RemoveHeader(udp);
            NetcodePacketHeader nph;
            if (copy->GetSize() >= nph.GetSerializedSize()) {
                copy->RemoveHeader(nph);
                if (nph.IsValid()) {
                    seq = nph.GetSeqNum();
                }
            }
        }
    } catch (...) {}

    std::cout << "EVENT_JSON:{\"transfer_id\":\"" << g_simTransferId
              << "\",\"type\":\"packet_dropped\",\"protocol\":\"phy\",\"time\":" << nowSec
              << ",\"seq_id\":" << seq
              << ",\"direction\":\"forward\",\"drop_count\":" << g_forwardPhyDrops << "}" << std::endl;
}

static void ReversePhyDropSink(Ptr<const Packet> p) {
    g_reversePhyDrops++;
    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::cout << "EVENT_JSON:{\"transfer_id\":\"" << g_simTransferId
              << "\",\"type\":\"packet_dropped\",\"protocol\":\"phy\",\"time\":" << nowSec
              << ",\"direction\":\"reverse\",\"drop_count\":" << g_reversePhyDrops << "}" << std::endl;
}

int main(int argc, char *argv[]) {
    std::string protocolStr = "RLNC";
    double lossPercent = 0.0;
    std::string delayStr = "20ms";
    std::string bandwidthStr = "10Mbps";
    std::string inputFilePath = "";
    std::string outputFilePath = "";
    std::string tracePath = "results/trace.xml";
    uint32_t K = 4;
    uint32_t blockSize = 1024;
    uint32_t redundancy = 2;
    uint32_t timeoutMs = 200;
    uint32_t maxRetries = 10;
    uint32_t transferId = 1;
    double stopTimeSec = 30.0;
    uint32_t randomSeed = 1;

    CommandLine cmd(__FILE__);
    cmd.AddValue("protocol", "Protocol to simulate: RLNC or RUDP", protocolStr);
    cmd.AddValue("loss", "Packet loss rate in percent (0 to 90)", lossPercent);
    cmd.AddValue("delay", "Link propagation delay (e.g. 20ms)", delayStr);
    cmd.AddValue("bandwidth", "Link bandwidth (e.g. 10Mbps)", bandwidthStr);
    cmd.AddValue("file", "Path to input file to transfer", inputFilePath);
    cmd.AddValue("out", "Path to reconstructed output file", outputFilePath);
    cmd.AddValue("trace", "Path to generated NetAnim XML trace", tracePath);
    cmd.AddValue("k", "RLNC generation size K", K);
    cmd.AddValue("block-size", "Payload block size in bytes", blockSize);
    cmd.AddValue("redundancy", "RLNC redundancy packets per generation", redundancy);
    cmd.AddValue("timeout", "RUDP timeout in milliseconds", timeoutMs);
    cmd.AddValue("max-retries", "RUDP maximum retries", maxRetries);
    cmd.AddValue("transfer-id", "Transfer ID", transferId);
    cmd.AddValue("stop-time", "Simulation stop time in seconds", stopTimeSec);
    cmd.AddValue("seed", "Random seed / run number", randomSeed);
    cmd.Parse(argc, argv);

    g_simTransferId = transferId;

    // Ensure output and trace directories exist
    try {
        if (!tracePath.empty()) {
            std::filesystem::path tp(tracePath);
            if (tp.has_parent_path()) {
                std::filesystem::create_directories(tp.parent_path());
            }
        }
        if (!outputFilePath.empty()) {
            std::filesystem::path op(outputFilePath);
            if (op.has_parent_path()) {
                std::filesystem::create_directories(op.parent_path());
            }
        }
    } catch (...) {}


    // Validate parameters
    if (lossPercent < 0.0 || lossPercent > 99.0) {
        std::cerr << "ERROR: Invalid loss rate " << lossPercent << "%. Must be between 0 and 99." << std::endl;
        return 1;
    }
    if (K < 1 || K > 64) {
        std::cerr << "ERROR: Invalid K " << K << ". Must be between 1 and 64." << std::endl;
        return 1;
    }
    if (blockSize < 8 || blockSize > 65535) {
        std::cerr << "ERROR: Invalid block size " << blockSize << ". Must be between 8 and 65535." << std::endl;
        return 1;
    }

    // Set NS-3 random seed
    RngSeedManager::SetSeed(randomSeed);
    RngSeedManager::SetRun(1);
    srand(randomSeed);

    // Initialize GF(256) tables
    gf256_init();

    // Prepare source data
    std::vector<uint8_t> sourceData;
    bool fileLoaded = false;
    if (!inputFilePath.empty()) {
        std::ifstream ifs(inputFilePath, std::ios::binary);
        if (ifs) {
            fileLoaded = true;
            sourceData.assign((std::istreambuf_iterator<char>(ifs)),
                              (std::istreambuf_iterator<char>()));
        } else {
            std::cerr << "WARNING: Could not open input file " << inputFilePath << ", using deterministic test data." << std::endl;
        }
    }

    if (!fileLoaded) {
        // Create deterministic test data only if no input file was loaded
        size_t testSize = (size_t)K * blockSize;
        sourceData.resize(testSize);
        for (size_t i = 0; i < testSize; i++) {
            sourceData[i] = (uint8_t)((i * 37 + 13) & 0xFF);
        }
    }

    std::string originalSha256 = sha256_bytes(sourceData.data(), sourceData.size());

    std::cout << "========================================================\n"
              << " NetCode-RFT Native NS-3 Simulator\n"
              << " Protocol:      " << protocolStr << "\n"
              << " Configured Loss: " << lossPercent << "%\n"
              << " Delay:         " << delayStr << "\n"
              << " Bandwidth:     " << bandwidthStr << "\n"
              << " File Size:     " << sourceData.size() << " bytes\n"
              << " Original SHA:  " << originalSha256 << "\n"
              << " NetAnim Trace: " << tracePath << "\n"
              << "========================================================" << std::endl;

    // Build NS-3 Topology: 2 nodes (Sender = 0, Receiver = 1)
    NodeContainer nodes;
    nodes.Create(2);

    PointToPointHelper p2p;
    p2p.SetDeviceAttribute("DataRate", StringValue(bandwidthStr));
    p2p.SetChannelAttribute("Delay", StringValue(delayStr));

    NetDeviceContainer devices = p2p.Install(nodes);

    // Attach drop sinks directly to physical network devices
    devices.Get(1)->TraceConnectWithoutContext("PhyRxDrop", MakeCallback(&ForwardPhyDropSink));
    devices.Get(0)->TraceConnectWithoutContext("PhyRxDrop", MakeCallback(&ReversePhyDropSink));

    // Configure Real Packet Loss Model on the channel/devices
    if (lossPercent > 0.0) {
        Ptr<RateErrorModel> emForward = CreateObject<RateErrorModel>();
        emForward->SetAttribute("ErrorRate", DoubleValue(lossPercent / 100.0));
        emForward->SetAttribute("ErrorUnit", StringValue("ERROR_UNIT_PACKET"));
        devices.Get(1)->SetAttribute("ReceiveErrorModel", PointerValue(emForward));

        Ptr<RateErrorModel> emReverse = CreateObject<RateErrorModel>();
        emReverse->SetAttribute("ErrorRate", DoubleValue(lossPercent / 100.0));
        emReverse->SetAttribute("ErrorUnit", StringValue("ERROR_UNIT_PACKET"));
        devices.Get(0)->SetAttribute("ReceiveErrorModel", PointerValue(emReverse));
    }

    // Install Internet Stack
    InternetStackHelper stack;
    stack.Install(nodes);

    Ipv4AddressHelper address;
    address.SetBase("10.1.1.0", "255.255.255.0");
    Ipv4InterfaceContainer interfaces = address.Assign(devices);

    Ipv4Address senderIp = interfaces.GetAddress(0);
    Ipv4Address receiverIp = interfaces.GetAddress(1);
    uint16_t port = 9000;

    // Sockets
    Ptr<Socket> senderSocket = Socket::CreateSocket(nodes.Get(0), UdpSocketFactory::GetTypeId());
    senderSocket->Bind(InetSocketAddress(senderIp, port));

    Ptr<Socket> receiverSocket = Socket::CreateSocket(nodes.Get(1), UdpSocketFactory::GetTypeId());
    receiverSocket->Bind(InetSocketAddress(receiverIp, port));

    // NetAnim Configuration
    AnimationInterface anim(tracePath);
    anim.SetConstantPosition(nodes.Get(0), 10.0, 50.0);
    anim.SetConstantPosition(nodes.Get(1), 90.0, 50.0);
    anim.UpdateNodeDescription(nodes.Get(0), "Sender (Node 0)");
    anim.UpdateNodeDescription(nodes.Get(1), "Receiver (Node 1)");
    anim.UpdateNodeColor(nodes.Get(0), 0, 120, 255);
    anim.UpdateNodeColor(nodes.Get(1), 40, 200, 80);
    anim.EnablePacketMetadata(true);

    // State tracked for final metrics
    bool transferSuccess = false;
    double simElapsedTime = 0.0;
    std::string reconstructedSha256 = "";
    std::vector<uint8_t> reconstructedBytes;

    Ptr<RudpSenderApplication> rudpSender = nullptr;
    Ptr<RudpReceiverApplication> rudpReceiver = nullptr;
    Ptr<RlncSenderApplication> rlncSender = nullptr;
    Ptr<RlncReceiverApplication> rlncReceiver = nullptr;

    if (protocolStr == "RUDP" || protocolStr == "rudp") {
        rudpSender = CreateObject<RudpSenderApplication>();
        rudpSender->Setup(senderSocket, InetSocketAddress(receiverIp, port),
                          sourceData, blockSize, MilliSeconds(timeoutMs), maxRetries, transferId);
        nodes.Get(0)->AddApplication(rudpSender);
        rudpSender->SetStartTime(Seconds(0.1));
        rudpSender->SetStopTime(Seconds(stopTimeSec));

        rudpReceiver = CreateObject<RudpReceiverApplication>();
        rudpReceiver->Setup(receiverSocket, transferId);
        nodes.Get(1)->AddApplication(rudpReceiver);
        rudpReceiver->SetStartTime(Seconds(0.0));
        rudpReceiver->SetStopTime(Seconds(stopTimeSec));

        rudpSender->SetCallbacks(
            nullptr,
            [&](bool success, double elapsed, uint32_t sent, uint32_t retries, uint32_t acks) {
                transferSuccess = success;
                simElapsedTime = elapsed;
            }
        );

        rudpReceiver->SetCallbacks(
            nullptr,
            [&](const std::vector<uint8_t> &data, const std::string &hash) {
                reconstructedBytes = data;
                reconstructedSha256 = hash;
            }
        );

    } else { // RLNC
        rlncSender = CreateObject<RlncSenderApplication>();
        rlncSender->Setup(senderSocket, InetSocketAddress(receiverIp, port),
                          sourceData, blockSize, (uint8_t)K, redundancy, MilliSeconds(10), transferId);
        nodes.Get(0)->AddApplication(rlncSender);
        rlncSender->SetStartTime(Seconds(0.1));
        rlncSender->SetStopTime(Seconds(stopTimeSec));

        rlncReceiver = CreateObject<RlncReceiverApplication>();
        rlncReceiver->Setup(receiverSocket, sourceData.size(), blockSize, (uint8_t)K, transferId);
        nodes.Get(1)->AddApplication(rlncReceiver);
        rlncReceiver->SetStartTime(Seconds(0.0));
        rlncReceiver->SetStopTime(Seconds(stopTimeSec));

        rlncSender->SetCallbacks(
            nullptr,
            [&](bool success, double elapsed, uint32_t sent, uint32_t coded, uint32_t genAcks) {
                transferSuccess = success;
                simElapsedTime = elapsed;
            }
        );

        rlncReceiver->SetCallbacks(
            nullptr,
            [&](const std::vector<uint8_t> &data, const std::string &hash) {
                reconstructedBytes = data;
                reconstructedSha256 = hash;
            }
        );
    }

    // Run NS-3 Simulation
    Simulator::Stop(Seconds(stopTimeSec));
    Simulator::Run();

    // Query granular protocol counters before destroying simulator
    uint32_t dataPacketsSent = 0;
    uint32_t dataPacketsReceived = 0;
    uint32_t controlPacketsSent = 0;
    uint32_t retransOrRepairPackets = 0;
    uint32_t totalSentPackets = 0;
    uint32_t totalReceivedPackets = 0;
    uint32_t totalRetransmissions = 0;
    uint32_t totalCodedPackets = 0;
    uint32_t totalAcksSent = 0;
    uint32_t totalAcksReceived = 0;
    uint32_t totalInnovative = 0;
    uint32_t totalDependent = 0;
    uint16_t decodedGenerations = 0;
    uint32_t sourceBlocks = (sourceData.size() + blockSize - 1) / blockSize;

    if (rudpSender && rudpReceiver) {
        dataPacketsSent = rudpSender->GetDataPacketsSent();
        dataPacketsReceived = rudpReceiver->GetDataPacketsReceived();
        retransOrRepairPackets = rudpSender->GetRetransmissionsSent();
        totalSentPackets = rudpSender->GetTotalSent(); // data + FIN
        totalRetransmissions = rudpSender->GetRetransmissionsSent();
        totalCodedPackets = 0;
        totalAcksSent = rudpReceiver->GetDataAcksSent() + rudpReceiver->GetFinAcksSent();
        totalAcksReceived = rudpSender->GetDataAcksReceived() + rudpSender->GetFinAcksReceived();
        controlPacketsSent = rudpSender->GetFinSent() + totalAcksSent;
        totalReceivedPackets = rudpReceiver->GetTotalReceivedPackets();
    } else if (rlncSender && rlncReceiver) {
        dataPacketsSent = rlncSender->GetDataPacketsSent();
        dataPacketsReceived = rlncReceiver->GetDataPacketsReceived();
        retransOrRepairPackets = rlncSender->GetCodedSent() + rlncSender->GetRepairBurstSent();
        totalSentPackets = rlncSender->GetTotalSent(); // data + FIN
        totalRetransmissions = 0;
        totalCodedPackets = retransOrRepairPackets;
        totalAcksSent = rlncReceiver->GetGenAcksSent() + rlncReceiver->GetFinAcksSent();
        totalAcksReceived = rlncSender->GetGenAcksReceived() + rlncSender->GetFinAcksReceived();
        controlPacketsSent = rlncSender->GetFinSent() + totalAcksSent;
        totalReceivedPackets = rlncReceiver->GetTotalReceived();
        totalInnovative = rlncReceiver->GetTotalInnovative();
        totalDependent = rlncReceiver->GetTotalDependent();
        decodedGenerations = rlncReceiver->GetDecodedGenerations();
    }

    Simulator::Destroy();

    // Verify reconstruction
    bool hashMatch = (!reconstructedSha256.empty() && originalSha256 == reconstructedSha256);
    bool byteMatch = (sourceData.size() == reconstructedBytes.size() &&
                      (sourceData.empty() || std::memcmp(sourceData.data(), reconstructedBytes.data(), sourceData.size()) == 0));
    bool verifiedIntegrity = hashMatch && byteMatch;

    // Write reconstructed file if output path given
    if (!outputFilePath.empty()) {
        std::ofstream ofs(outputFilePath, std::ios::binary);
        if (ofs && !reconstructedBytes.empty()) {
            ofs.write(reinterpret_cast<const char*>(reconstructedBytes.data()), reconstructedBytes.size());
        }
    }

    // Goodput (Kbps)
    // Numerator: sourceData.size() * 8.0 (useful application payload bits reconstructed)
    // Denominator: simElapsedTime * 1000.0 (elapsed transfer duration in ms -> yields Kbps)
    double goodputKbps = 0.0;
    if (simElapsedTime > 0.0 && verifiedIntegrity) {
        goodputKbps = (sourceData.size() * 8.0) / (simElapsedTime * 1000.0);
    }

    // Observed physical loss percentage on application data packets
    // In NS-3 P2P, packets not dropped by the error model arrive at the receiver.
    // Therefore (dataPacketsSent - dataPacketsReceived) / dataPacketsSent is the true observed packet loss.
    double observedLossRate = 0.0;
    if (dataPacketsSent > 0 && dataPacketsSent >= dataPacketsReceived) {
        observedLossRate = ((double)(dataPacketsSent - dataPacketsReceived) / (double)dataPacketsSent) * 100.0;
    }

    // Application-level Packet Delivery Ratio (PDR %)
    double pdrPercent = 0.0;
    if (dataPacketsSent > 0) {
        pdrPercent = ((double)dataPacketsReceived / (double)dataPacketsSent) * 100.0;
        if (pdrPercent > 100.0) pdrPercent = 100.0;
    }

    // Transmission Redundancy / Retransmission Overhead (%)
    // Overhead = (retransmitted or repair packets sent) / (source blocks) * 100
    double transmissionOverheadPercent = 0.0;
    if (sourceBlocks > 0) {
        transmissionOverheadPercent = ((double)retransOrRepairPackets / (double)sourceBlocks) * 100.0;
    }

    // Total wire overhead (%) = (total packets sent on wire - source blocks) / source blocks * 100
    double wireOverheadPercent = 0.0;
    if (sourceBlocks > 0 && totalSentPackets >= sourceBlocks) {
        wireOverheadPercent = ((double)(totalSentPackets - sourceBlocks) / (double)sourceBlocks) * 100.0;
    }

    // Emit Final METRICS_JSON
    std::ostringstream mj;
    mj << "METRICS_JSON:{"
       << "\"transfer_id\":\"" << transferId << "\","
       << "\"protocol\":\"" << protocolStr << "\","
       << "\"success\":" << (verifiedIntegrity ? "true" : "false") << ","
       << "\"sim_time_sec\":" << std::fixed << std::setprecision(4) << simElapsedTime << ","
       << "\"file_size_bytes\":" << sourceData.size() << ","
       << "\"source_blocks\":" << sourceBlocks << ","
       << "\"original_sha256\":\"" << originalSha256 << "\","
       << "\"reconstructed_sha256\":\"" << reconstructedSha256 << "\","
       << "\"integrity_verified\":" << (verifiedIntegrity ? "true" : "false") << ","
       << "\"data_packets_sent\":" << dataPacketsSent << ","
       << "\"data_packets_received\":" << dataPacketsReceived << ","
       << "\"control_packets_sent\":" << controlPacketsSent << ","
       << "\"retrans_or_repair_packets\":" << retransOrRepairPackets << ","
       << "\"total_sent_packets\":" << totalSentPackets << ","
       << "\"total_received_packets\":" << totalReceivedPackets << ","
       << "\"total_retransmissions\":" << totalRetransmissions << ","
       << "\"total_coded_packets\":" << totalCodedPackets << ","
       << "\"total_acks\":" << totalAcksReceived << ","
       << "\"total_innovative\":" << totalInnovative << ","
       << "\"total_dependent\":" << totalDependent << ","
       << "\"decoded_generations\":" << decodedGenerations << ","
       << "\"forward_phy_drops\":" << g_forwardPhyDrops << ","
       << "\"reverse_phy_drops\":" << g_reversePhyDrops << ","
       << "\"total_phy_drops\":" << (g_forwardPhyDrops + g_reversePhyDrops) << ","
       << "\"configured_loss_percent\":" << lossPercent << ","
       << "\"observed_loss_rate\":" << std::fixed << std::setprecision(4) << observedLossRate << ","
       << "\"physical_loss_percent\":" << std::fixed << std::setprecision(4) << observedLossRate << ","
       << "\"packet_delivery_ratio_percent\":" << std::fixed << std::setprecision(4) << pdrPercent << ","
       << "\"transmission_overhead_percent\":" << std::fixed << std::setprecision(4) << transmissionOverheadPercent << ","
       << "\"wire_overhead_percent\":" << std::fixed << std::setprecision(4) << wireOverheadPercent << ","
       << "\"goodput_kbps\":" << std::fixed << std::setprecision(2) << goodputKbps << ","
       << "\"trace_file\":\"" << tracePath << "\""
       << "}";

    std::cout << mj.str() << std::endl;

    std::cout << "\n================ SIMULATION RESULT ================\n"
              << " Protocol:      " << protocolStr << "\n"
              << " Status:        " << (verifiedIntegrity ? "SUCCESS" : "FAILED") << "\n"
              << " Sim Duration:  " << simElapsedTime << " s\n"
              << " Goodput:       " << goodputKbps << " Kbps\n"
              << " Original SHA:  " << originalSha256 << "\n"
              << " Recon SHA:     " << reconstructedSha256 << "\n"
              << " Data Sent/Rcv: " << dataPacketsSent << " / " << dataPacketsReceived << "\n"
              << " Phy Drops:     " << g_forwardPhyDrops << " fwd, " << g_reversePhyDrops << " rev\n"
              << " PDR:           " << pdrPercent << " %\n"
              << " Obs Loss:      " << observedLossRate << " %\n"
              << " NetAnim Trace: " << tracePath << "\n"
              << "===================================================" << std::endl;

    return verifiedIntegrity ? 0 : 1;
}
