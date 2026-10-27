#include "rlnc-application.h"
#include "ns3/log.h"
#include "ns3/simulator.h"
#include "ns3/inet-socket-address.h"
#include "sha256.h"
#include <iostream>
#include <sstream>
#include <random>

namespace netcode {

NS_LOG_COMPONENT_DEFINE("NetcodeRlncApplication");

static std::string FormatEquation(const std::vector<uint8_t> &coeffs, uint8_t K) {
    std::ostringstream oss;
    bool first = true;
    for (size_t i = 0; i < coeffs.size() && i < (size_t)K; i++) {
        uint8_t c = coeffs[i];
        if (c == 0) continue;
        if (!first) oss << " ⊕ ";
        first = false;
        if (c == 1) {
            oss << "x" << (i + 1);
        } else {
            oss << (int)c << "·x" << (i + 1);
        }
    }
    if (first) return "0";
    return oss.str();
}

template <typename T>
static std::string VectorToJsonArray(const std::vector<T> &vec) {
    std::ostringstream oss;
    oss << "[";
    for (size_t i = 0; i < vec.size(); i++) {
        if (i > 0) oss << ",";
        oss << (int)vec[i];
    }
    oss << "]";
    return oss.str();
}

static std::string PreviewToJsonArray(const uint8_t *data, size_t len, size_t maxLen = 6) {
    std::ostringstream oss;
    oss << "[";
    size_t count = std::min(len, maxLen);
    for (size_t i = 0; i < count; i++) {
        if (i > 0) oss << ",";
        oss << (int)data[i];
    }
    oss << "]";
    return oss.str();
}

// ---------------- RlncGenDecoder ----------------

RlncGenDecoder::RlncGenDecoder(uint8_t k, uint32_t bSize)
    : K(k),
      blockSize(bSize),
      rank(0),
      innovativeCount(0),
      dependentCount(0),
      isComplete(false)
{
    matrix.resize(K, std::vector<uint8_t>(K + blockSize, 0));
    hasRow.resize(K, false);
}

bool RlncGenDecoder::AddPacket(const std::vector<uint8_t> &coeffs, const uint8_t *payload, uint16_t genId,
                              std::function<void(const std::string&)> eventCb, uint32_t transferId, uint32_t seqNum) {
    int rankBefore = rank;
    double nowSec = ns3::Simulator::Now().GetSeconds();

    std::string eqStr = FormatEquation(coeffs, K);
    std::string coeffsJson = VectorToJsonArray(coeffs);
    std::string payloadPreviewJson = payload ? PreviewToJsonArray(payload, blockSize, 6) : "[]";

    if (isComplete) {
        dependentCount++;
        std::ostringstream oss;
        oss << "EVENT_JSON:{\"transfer_id\":\"" << transferId
            << "\",\"type\":\"decoder_matrix_update\",\"protocol\":\"rlnc\",\"time\":" << nowSec
            << ",\"seq_id\":" << seqNum
            << ",\"packet_id\":" << seqNum
            << ",\"gen_id\":" << genId
            << ",\"rank\":" << rank
            << ",\"rank_before\":" << rankBefore
            << ",\"rank_after\":" << rank
            << ",\"required_rank\":" << (int)K
            << ",\"innovative\":false"
            << ",\"equation\":\"" << eqStr << "\""
            << ",\"coeffs\":" << coeffsJson
            << ",\"payload_preview\":" << payloadPreviewJson
            << ",\"operations\":[\"Generation already complete with full rank " << (int)K << "\"]}";
        if (eventCb) eventCb(oss.str());
        std::cout << oss.str() << std::endl;
        return false;
    }

    // Create temporary augmented row: K coefficients + blockSize payload
    std::vector<uint8_t> row(K + blockSize, 0);
    size_t cLen = std::min((size_t)K, coeffs.size());
    for (size_t i = 0; i < cLen; i++) {
        row[i] = coeffs[i];
    }
    if (payload && blockSize > 0) {
        std::memcpy(&row[K], payload, blockSize);
    }

    std::vector<std::string> ops;

    // Progressive Gauss-Jordan elimination against existing pivot rows
    for (int i = 0; i < K; i++) {
        if (row[i] != 0) {
            if (!hasRow[i]) {
                // New pivot found at row i!
                uint8_t pivot = row[i];
                uint8_t inv_pivot = gf256_inv(pivot);

                // Normalize this row so pivot is 1
                gf256_row_mul(row.data(), K + blockSize, inv_pivot);
                ops.push_back("Normalize Row " + std::to_string(i + 1) + ": R" + std::to_string(i + 1) +
                              " ← R" + std::to_string(i + 1) + " ⊗ " + std::to_string((int)inv_pivot) +
                              " (inv of " + std::to_string((int)pivot) + ")");

                // Eliminate all other existing pivot columns from this new pivot row
                for (int c2 = 0; c2 < K; c2++) {
                    if (c2 != i && hasRow[c2] && row[c2] != 0) {
                        uint8_t factor = row[c2];
                        gf256_row_madd(row.data(), matrix[c2].data(), K + blockSize, factor);
                        ops.push_back("Forward Eliminate Col " + std::to_string(c2 + 1) + " from Row " + std::to_string(i + 1) +
                                      ": R" + std::to_string(i + 1) + " ← R" + std::to_string(i + 1) + " ⊕ (" +
                                      std::to_string((int)factor) + " ⊗ R" + std::to_string(c2 + 1) + ")");
                    }
                }

                // Eliminate this column from all other existing rows (Gauss-Jordan)
                for (int r = 0; r < K; r++) {
                    if (r != i && hasRow[r] && matrix[r][i] != 0) {
                        uint8_t factor = matrix[r][i];
                        gf256_row_madd(matrix[r].data(), row.data(), K + blockSize, factor);
                        ops.push_back("Back-Substitute Col " + std::to_string(i + 1) + " from Row " + std::to_string(r + 1) +
                                      ": R" + std::to_string(r + 1) + " ← R" + std::to_string(r + 1) + " ⊕ (" +
                                      std::to_string((int)factor) + " ⊗ R" + std::to_string(i + 1) + ")");
                    }
                }

                // Store as pivot row
                matrix[i] = row;
                hasRow[i] = true;
                rank++;
                innovativeCount++;

                if (rank == K) {
                    isComplete = true;
                }

                // Construct current matrix A and matrix Y preview JSON
                std::ostringstream aOss, yOss;
                aOss << "[";
                yOss << "[";
                for (int r = 0; r < K; r++) {
                    if (r > 0) { aOss << ","; yOss << ","; }
                    aOss << "[";
                    yOss << "[";
                    for (int c = 0; c < K; c++) {
                        if (c > 0) aOss << ",";
                        aOss << (int)(hasRow[r] ? matrix[r][c] : 0);
                    }
                    aOss << "]";
                    for (size_t b = 0; b < 6 && b < blockSize; b++) {
                        if (b > 0) yOss << ",";
                        yOss << (int)(hasRow[r] ? matrix[r][K + b] : 0);
                    }
                    yOss << "]";
                }
                aOss << "]";
                yOss << "]";

                // Construct operations JSON
                std::ostringstream opsOss;
                opsOss << "[";
                for (size_t opIdx = 0; opIdx < ops.size(); opIdx++) {
                    if (opIdx > 0) opsOss << ",";
                    opsOss << "\"" << ops[opIdx] << "\"";
                }
                opsOss << "]";

                // Emit event
                std::ostringstream oss;
                oss << "EVENT_JSON:{\"transfer_id\":\"" << transferId
                    << "\",\"type\":\"decoder_matrix_update\",\"protocol\":\"rlnc\",\"time\":" << nowSec
                    << ",\"seq_id\":" << seqNum
                    << ",\"packet_id\":" << seqNum
                    << ",\"gen_id\":" << genId
                    << ",\"rank\":" << rank
                    << ",\"rank_before\":" << rankBefore
                    << ",\"rank_after\":" << rank
                    << ",\"required_rank\":" << (int)K
                    << ",\"innovative\":true"
                    << ",\"equation\":\"" << eqStr << "\""
                    << ",\"coeffs\":" << coeffsJson
                    << ",\"payload_preview\":" << payloadPreviewJson
                    << ",\"matrix_a\":" << aOss.str()
                    << ",\"matrix_y\":" << yOss.str()
                    << ",\"operations\":" << opsOss.str()
                    << "}";
                if (eventCb) eventCb(oss.str());
                std::cout << oss.str() << std::endl;

                if (isComplete) {
                    std::ostringstream compOss;
                    compOss << "EVENT_JSON:{\"transfer_id\":\"" << transferId
                            << "\",\"type\":\"generation_complete\",\"protocol\":\"rlnc\",\"time\":" << nowSec
                            << ",\"gen_id\":" << genId << ",\"rank\":" << rank << "}";
                    if (eventCb) eventCb(compOss.str());
                    std::cout << compOss.str() << std::endl;
                }

                return true; // Innovative equation
            } else {
                // Eliminate leading term using existing pivot row i
                uint8_t factor = row[i];
                gf256_row_madd(row.data(), matrix[i].data(), K + blockSize, factor);
                ops.push_back("Eliminate Col " + std::to_string(i + 1) + ": R_new ← R_new ⊕ (" +
                              std::to_string((int)factor) + " ⊗ R" + std::to_string(i + 1) + ")");
            }
        }
    }

    // If all coefficients eliminated to zero, this packet is linearly dependent
    dependentCount++;
    ops.push_back("Linearly dependent row reduced to all zero coefficients (rank remains " + std::to_string(rank) + ")");

    std::ostringstream aOss, yOss, opsOss;
    aOss << "["; yOss << "[";
    for (int r = 0; r < K; r++) {
        if (r > 0) { aOss << ","; yOss << ","; }
        aOss << "["; yOss << "[";
        for (int c = 0; c < K; c++) {
            if (c > 0) aOss << ",";
            aOss << (int)(hasRow[r] ? matrix[r][c] : 0);
        }
        aOss << "]";
        for (size_t b = 0; b < 6 && b < blockSize; b++) {
            if (b > 0) yOss << ",";
            yOss << (int)(hasRow[r] ? matrix[r][K + b] : 0);
        }
        yOss << "]";
    }
    aOss << "]"; yOss << "]";

    opsOss << "[";
    for (size_t opIdx = 0; opIdx < ops.size(); opIdx++) {
        if (opIdx > 0) opsOss << ",";
        opsOss << "\"" << ops[opIdx] << "\"";
    }
    opsOss << "]";

    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << transferId
        << "\",\"type\":\"decoder_matrix_update\",\"protocol\":\"rlnc\",\"time\":" << nowSec
        << ",\"seq_id\":" << seqNum
        << ",\"packet_id\":" << seqNum
        << ",\"gen_id\":" << genId
        << ",\"rank\":" << rank
        << ",\"rank_before\":" << rankBefore
        << ",\"rank_after\":" << rank
        << ",\"required_rank\":" << (int)K
        << ",\"innovative\":false"
        << ",\"equation\":\"" << eqStr << "\""
        << ",\"coeffs\":" << coeffsJson
        << ",\"payload_preview\":" << payloadPreviewJson
        << ",\"matrix_a\":" << aOss.str()
        << ",\"matrix_y\":" << yOss.str()
        << ",\"operations\":" << opsOss.str()
        << "}";
    if (eventCb) eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    return false; // Dependent
}

bool RlncGenDecoder::RecoverBlocks(std::vector<std::vector<uint8_t>> &recoveredBlocks) {
    if (!isComplete || rank != K) return false;

    // Because Gauss-Jordan elimination reduces matrix into identity form:
    // row i has 1 at column i and 0 elsewhere, so matrix[i][K ... K+blockSize-1] is source block i!
    recoveredBlocks.resize(K);
    for (int i = 0; i < K; i++) {
        recoveredBlocks[i].assign(&matrix[i][K], &matrix[i][K + blockSize]);
    }
    return true;
}

// ---------------- RlncSenderApplication ----------------

ns3::TypeId RlncSenderApplication::GetTypeId() {
    static ns3::TypeId tid = ns3::TypeId("netcode::RlncSenderApplication")
        .SetParent<ns3::Application>()
        .SetGroupName("Netcode")
        .AddConstructor<RlncSenderApplication>();
    return tid;
}

RlncSenderApplication::RlncSenderApplication()
    : m_blockSize(1024),
      m_K(4),
      m_redundancy(2),
      m_packetInterval(ns3::MilliSeconds(10)),
      m_transferId(1),
      m_currentGen(0),
      m_totalGenerations(0),
      m_packetsSentInGen(0),
      m_systematicSent(0),
      m_codedSent(0),
      m_repairBurstSent(0),
      m_finSent(0),
      m_genAcksReceived(0),
      m_finAcksReceived(0),
      m_finished(false)
{
}

RlncSenderApplication::~RlncSenderApplication() {
    m_socket = nullptr;
}

void RlncSenderApplication::Setup(ns3::Ptr<ns3::Socket> socket, ns3::Address peerAddress,
                                  const std::vector<uint8_t> &data, uint32_t blockSize,
                                  uint8_t K, uint32_t redundancy, ns3::Time packetInterval,
                                  uint32_t transferId) {
    m_socket = socket;
    m_peerAddress = peerAddress;
    m_data = data;
    m_blockSize = blockSize;
    m_K = (K == 0) ? 4 : K;
    m_redundancy = redundancy;
    m_packetInterval = packetInterval;
    m_transferId = transferId;

    // Partition source data into generations
    uint32_t bytesPerGen = (uint32_t)m_K * m_blockSize;
    if (m_data.empty()) {
        m_totalGenerations = 0;
    } else {
        m_totalGenerations = (m_data.size() + bytesPerGen - 1) / bytesPerGen;
    }

    m_genBlocks.resize(m_totalGenerations);
    for (uint16_t g = 0; g < m_totalGenerations; g++) {
        m_genBlocks[g].resize(m_K, std::vector<uint8_t>(m_blockSize, 0));
        for (uint8_t b = 0; b < m_K; b++) {
            size_t offset = (size_t)g * bytesPerGen + (size_t)b * m_blockSize;
            if (offset < m_data.size()) {
                size_t len = std::min((size_t)m_blockSize, m_data.size() - offset);
                std::memcpy(m_genBlocks[g][b].data(), &m_data[offset], len);
                // Zero-pad remainder of block (already 0-initialized)
            }
        }
    }
}

void RlncSenderApplication::SetCallbacks(
    std::function<void(const std::string&)> eventCb,
    std::function<void(bool, double, uint32_t, uint32_t, uint32_t)> metricsCb) {
    m_eventCb = eventCb;
    m_metricsCb = metricsCb;
}

void RlncSenderApplication::StartApplication() {
    m_socket->SetRecvCallback(ns3::MakeCallback(&RlncSenderApplication::HandleRead, this));
    m_startTime = ns3::Simulator::Now();
    m_currentGen = 0;
    m_packetsSentInGen = 0;
    m_finished = false;

    // Start sending packets for first generation
    SendNextPacket();
}

void RlncSenderApplication::StopApplication() {
    if (m_sendNextEvent.IsRunning()) m_sendNextEvent.Cancel();
    if (m_genTimeoutEvent.IsRunning()) m_genTimeoutEvent.Cancel();
    if (m_socket) m_socket->Close();
}

void RlncSenderApplication::SendNextPacket() {
    if (m_finished || m_currentGen >= m_totalGenerations) {
        SendFin();
        return;
    }

    // In current generation:
    // First K packets are Systematic (unit vectors)
    // Subsequent packets (up to K + redundancy) are Coded RLNC packets
    uint32_t maxPackets = (uint32_t)m_K + m_redundancy;

    if (m_packetsSentInGen < (uint32_t)m_K) {
        // Send Systematic packet b = m_packetsSentInGen
        uint8_t b = (uint8_t)m_packetsSentInGen;
        std::vector<uint8_t> coeffs(m_K, 0);
        coeffs[b] = 1; // Unit vector

        const std::vector<uint8_t> &payload = m_genBlocks[m_currentGen][b];
        uint32_t seqId = GetTotalSent();

        NetcodePacketHeader header;
        header.SetType(PKT_RLNC_SYSTEMATIC);
        header.SetTransferId(m_transferId);
        header.SetSeqNum(seqId);
        header.SetGenId(m_currentGen);
        header.SetK(m_K);
        header.SetPayloadSize(m_blockSize);
        header.SetCoefficients(coeffs);

        ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>(payload.data(), payload.size());
        pkt->AddHeader(header);

        m_socket->SendTo(pkt, 0, m_peerAddress);
        m_systematicSent++;
        m_packetsSentInGen++;

        double nowSec = ns3::Simulator::Now().GetSeconds();
        std::ostringstream oss;
        oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
            << "\",\"type\":\"packet_transmitted\",\"protocol\":\"rlnc\",\"time\":" << nowSec
            << ",\"seq_id\":" << seqId
            << ",\"packet_id\":" << seqId
            << ",\"gen_id\":" << m_currentGen
            << ",\"packet_index\":" << (int)b
            << ",\"coded\":false,\"pkt_type\":\"Systematic\""
            << ",\"coeffs\":" << VectorToJsonArray(coeffs)
            << ",\"payload_len\":" << m_blockSize
            << ",\"data_preview\":" << PreviewToJsonArray(payload.data(), payload.size(), 6)
            << ",\"source_node\":0,\"destination_node\":1}";
        if (m_eventCb) m_eventCb(oss.str());
        std::cout << oss.str() << std::endl;

    } else if (m_packetsSentInGen < maxPackets) {
        // Send Coded RLNC packet with random coefficients over GF(256)
        std::vector<uint8_t> coeffs(m_K, 0);
        std::vector<uint8_t> codedPayload(m_blockSize, 0);

        // Deterministic pseudo-random generation based on seed
        for (uint8_t b = 0; b < m_K; b++) {
            uint8_t c = 0;
            while (c == 0) {
                c = (uint8_t)(rand() % 256);
            }
            coeffs[b] = c;
            gf256_row_madd(codedPayload.data(), m_genBlocks[m_currentGen][b].data(), m_blockSize, c);
        }

        uint32_t seqId = GetTotalSent();
        NetcodePacketHeader header;
        header.SetType(PKT_RLNC_CODED);
        header.SetTransferId(m_transferId);
        header.SetSeqNum(seqId);
        header.SetGenId(m_currentGen);
        header.SetK(m_K);
        header.SetPayloadSize(m_blockSize);
        header.SetCoefficients(coeffs);

        ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>(codedPayload.data(), codedPayload.size());
        pkt->AddHeader(header);

        m_socket->SendTo(pkt, 0, m_peerAddress);
        m_codedSent++;
        m_packetsSentInGen++;

        double nowSec = ns3::Simulator::Now().GetSeconds();
        std::ostringstream oss;
        oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
            << "\",\"type\":\"packet_transmitted\",\"protocol\":\"rlnc\",\"time\":" << nowSec
            << ",\"seq_id\":" << seqId
            << ",\"packet_id\":" << seqId
            << ",\"gen_id\":" << m_currentGen
            << ",\"packet_index\":" << (m_packetsSentInGen - 1)
            << ",\"coded\":true,\"pkt_type\":\"Mixed\""
            << ",\"coeffs\":" << VectorToJsonArray(coeffs)
            << ",\"payload_len\":" << m_blockSize
            << ",\"data_preview\":" << PreviewToJsonArray(codedPayload.data(), codedPayload.size(), 6)
            << ",\"source_node\":0,\"destination_node\":1}";
        if (m_eventCb) m_eventCb(oss.str());
        std::cout << oss.str() << std::endl;
    }

    // Schedule next packet or wait for generation ACK
    if (m_packetsSentInGen < maxPackets) {
        m_sendNextEvent = ns3::Simulator::Schedule(m_packetInterval, &RlncSenderApplication::SendNextPacket, this);
    } else {
        // All packets sent for this gen; schedule timeout in case gen ACK was lost
        if (m_genTimeoutEvent.IsRunning()) m_genTimeoutEvent.Cancel();
        m_genTimeoutEvent = ns3::Simulator::Schedule(ns3::MilliSeconds(250), &RlncSenderApplication::OnGenTimeout, this, m_currentGen);
    }
}

void RlncSenderApplication::OnGenTimeout(uint16_t genId) {
    if (m_finished || m_currentGen != genId) return;

    double nowSec = ns3::Simulator::Now().GetSeconds();

    // Send another coded repair packet
    std::vector<uint8_t> coeffs(m_K, 0);
    std::vector<uint8_t> codedPayload(m_blockSize, 0);
    for (uint8_t b = 0; b < m_K; b++) {
        uint8_t c = 0;
        while (c == 0) c = (uint8_t)(rand() % 256);
        coeffs[b] = c;
        gf256_row_madd(codedPayload.data(), m_genBlocks[m_currentGen][b].data(), m_blockSize, c);
    }

    uint32_t seqId = GetTotalSent();
    NetcodePacketHeader header;
    header.SetType(PKT_RLNC_CODED);
    header.SetTransferId(m_transferId);
    header.SetSeqNum(seqId);
    header.SetGenId(m_currentGen);
    header.SetK(m_K);
    header.SetPayloadSize(m_blockSize);
    header.SetCoefficients(coeffs);

    ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>(codedPayload.data(), codedPayload.size());
    pkt->AddHeader(header);

    m_socket->SendTo(pkt, 0, m_peerAddress);
    m_repairBurstSent++;

    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"packet_transmitted\",\"protocol\":\"rlnc\",\"time\":" << nowSec
        << ",\"seq_id\":" << seqId
        << ",\"packet_id\":" << seqId
        << ",\"gen_id\":" << genId
        << ",\"packet_index\":" << (m_packetsSentInGen + m_repairBurstSent - 1)
        << ",\"coded\":true,\"pkt_type\":\"Mixed (Retransmit)\",\"is_repair\":true"
        << ",\"coeffs\":" << VectorToJsonArray(coeffs)
        << ",\"payload_len\":" << m_blockSize
        << ",\"data_preview\":" << PreviewToJsonArray(codedPayload.data(), codedPayload.size(), 6)
        << ",\"source_node\":0,\"destination_node\":1}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    // Re-schedule timeout
    m_genTimeoutEvent = ns3::Simulator::Schedule(ns3::MilliSeconds(250), &RlncSenderApplication::OnGenTimeout, this, genId);
}

void RlncSenderApplication::SendFin() {
    NetcodePacketHeader header;
    header.SetType(PKT_RLNC_FIN);
    header.SetTransferId(m_transferId);
    header.SetSeqNum(GetTotalSent());
    header.SetGenId(m_totalGenerations);
    header.SetPayloadSize(0);

    ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>();
    pkt->AddHeader(header);

    m_socket->SendTo(pkt, 0, m_peerAddress);
    m_finSent++;

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"fin_sent\",\"protocol\":\"rlnc\",\"time\":" << nowSec << "}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    if (m_genTimeoutEvent.IsRunning()) m_genTimeoutEvent.Cancel();
    m_genTimeoutEvent = ns3::Simulator::Schedule(ns3::MilliSeconds(250), &RlncSenderApplication::SendFin, this);
}

void RlncSenderApplication::HandleRead(ns3::Ptr<ns3::Socket> socket) {
    ns3::Ptr<ns3::Packet> packet;
    ns3::Address from;
    while ((packet = socket->RecvFrom(from))) {
        NetcodePacketHeader header;
        packet->RemoveHeader(header);

        if (!header.IsValid() || header.GetTransferId() != m_transferId) continue;

        double nowSec = ns3::Simulator::Now().GetSeconds();

        if (header.GetType() == PKT_RLNC_GEN_ACK) {
            uint16_t ackGen = header.GetGenId();
            m_genAcksReceived++;

            std::ostringstream oss;
            oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                << "\",\"type\":\"gen_ack_received\",\"protocol\":\"rlnc\",\"time\":" << nowSec
                << ",\"gen_id\":" << ackGen << "}";
            if (m_eventCb) m_eventCb(oss.str());
            std::cout << oss.str() << std::endl;

            if (ackGen == m_currentGen) {
                if (m_genTimeoutEvent.IsRunning()) m_genTimeoutEvent.Cancel();
                if (m_sendNextEvent.IsRunning()) m_sendNextEvent.Cancel();

                m_currentGen++;
                m_packetsSentInGen = 0;

                if (m_currentGen < m_totalGenerations) {
                    SendNextPacket();
                } else {
                    SendFin();
                }
            }
        } else if (header.GetType() == PKT_RLNC_FIN_ACK) {
            m_finAcksReceived++;
            if (m_genTimeoutEvent.IsRunning()) m_genTimeoutEvent.Cancel();
            m_finished = true;

            std::ostringstream oss;
            oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                << "\",\"type\":\"fin_ack_received\",\"protocol\":\"rlnc\",\"time\":" << nowSec << "}";
            if (m_eventCb) m_eventCb(oss.str());
            std::cout << oss.str() << std::endl;

            double elapsedSec = nowSec - m_startTime.GetSeconds();
            if (m_metricsCb) {
                m_metricsCb(true, elapsedSec, GetDataPacketsSent(), m_codedSent + m_repairBurstSent, m_genAcksReceived);
            }
        }
    }
}

// ---------------- RlncReceiverApplication ----------------

ns3::TypeId RlncReceiverApplication::GetTypeId() {
    static ns3::TypeId tid = ns3::TypeId("netcode::RlncReceiverApplication")
        .SetParent<ns3::Application>()
        .SetGroupName("Netcode")
        .AddConstructor<RlncReceiverApplication>();
    return tid;
}

RlncReceiverApplication::RlncReceiverApplication()
    : m_totalFileSize(0),
      m_blockSize(1024),
      m_K(4),
      m_transferId(1),
      m_totalGenerations(0),
      m_completedGenerations(0),
      m_systematicReceived(0),
      m_codedReceived(0),
      m_finReceived(0),
      m_genAcksSent(0),
      m_finAcksSent(0),
      m_totalInnovative(0),
      m_totalDependent(0),
      m_finished(false)
{
}

RlncReceiverApplication::~RlncReceiverApplication() {
    m_socket = nullptr;
}

void RlncReceiverApplication::Setup(ns3::Ptr<ns3::Socket> socket, uint32_t totalFileSize,
                                    uint32_t blockSize, uint8_t K, uint32_t transferId) {
    m_socket = socket;
    m_totalFileSize = totalFileSize;
    m_blockSize = blockSize;
    m_K = (K == 0) ? 4 : K;
    m_transferId = transferId;

    uint32_t bytesPerGen = (uint32_t)m_K * m_blockSize;
    if (m_totalFileSize == 0) {
        m_totalGenerations = 0;
    } else {
        m_totalGenerations = (m_totalFileSize + bytesPerGen - 1) / bytesPerGen;
    }

    m_completedGenerations = 0;
    m_systematicReceived = 0;
    m_codedReceived = 0;
    m_finReceived = 0;
    m_genAcksSent = 0;
    m_finAcksSent = 0;
    m_totalInnovative = 0;
    m_totalDependent = 0;
    m_finished = false;
    m_decoders.clear();
    m_reconstructedData.clear();
}

void RlncReceiverApplication::SetCallbacks(
    std::function<void(const std::string&)> eventCb,
    std::function<void(const std::vector<uint8_t>&, const std::string&)> finishCb) {
    m_eventCb = eventCb;
    m_finishCb = finishCb;
}

void RlncReceiverApplication::StartApplication() {
    m_socket->SetRecvCallback(ns3::MakeCallback(&RlncReceiverApplication::HandleRead, this));
}

void RlncReceiverApplication::StopApplication() {
    if (m_socket) m_socket->Close();
}

void RlncReceiverApplication::HandleRead(ns3::Ptr<ns3::Socket> socket) {
    ns3::Ptr<ns3::Packet> packet;
    ns3::Address from;
    while ((packet = socket->RecvFrom(from))) {
        NetcodePacketHeader header;
        packet->RemoveHeader(header);

        if (!header.IsValid() || header.GetTransferId() != m_transferId) continue;

        if (header.GetType() == PKT_RLNC_SYSTEMATIC) {
            m_systematicReceived++;
            uint16_t genId = header.GetGenId();
            uint32_t seqId = header.GetSeqNum();

            if (m_decoders.find(genId) == m_decoders.end()) {
                m_decoders[genId] = RlncGenDecoder(m_K, m_blockSize);
            }

            RlncGenDecoder &dec = m_decoders[genId];
            bool wasComplete = dec.isComplete;

            std::vector<uint8_t> payload(m_blockSize, 0);
            uint32_t pLen = packet->GetSize();
            if (pLen > 0) {
                packet->CopyData(payload.data(), std::min((uint32_t)m_blockSize, pLen));
            }

            double nowSec = ns3::Simulator::Now().GetSeconds();
            std::ostringstream rxOss;
            rxOss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                  << "\",\"type\":\"packet_received\",\"protocol\":\"rlnc\",\"time\":" << nowSec
                  << ",\"seq_id\":" << seqId
                  << ",\"packet_id\":" << seqId
                  << ",\"gen_id\":" << genId
                  << ",\"payload_len\":" << m_blockSize
                  << ",\"coded\":false,\"pkt_type\":\"Systematic\""
                  << ",\"coeffs\":" << VectorToJsonArray(header.GetCoefficients())
                  << ",\"data_preview\":" << PreviewToJsonArray(payload.data(), payload.size(), 6)
                  << ",\"source_node\":0,\"destination_node\":1}";
            if (m_eventCb) m_eventCb(rxOss.str());
            std::cout << rxOss.str() << std::endl;

            bool inno = dec.AddPacket(header.GetCoefficients(), payload.data(), genId, m_eventCb, m_transferId, seqId);
            if (inno) {
                m_totalInnovative++;
            } else {
                m_totalDependent++;
            }

            if (!wasComplete && dec.isComplete) {
                m_completedGenerations++;
                SendGenAck(genId, from);
            } else if (dec.isComplete) {
                SendGenAck(genId, from);
            }

        } else if (header.GetType() == PKT_RLNC_CODED) {
            m_codedReceived++;
            uint16_t genId = header.GetGenId();
            uint32_t seqId = header.GetSeqNum();

            if (m_decoders.find(genId) == m_decoders.end()) {
                m_decoders[genId] = RlncGenDecoder(m_K, m_blockSize);
            }

            RlncGenDecoder &dec = m_decoders[genId];
            bool wasComplete = dec.isComplete;

            std::vector<uint8_t> payload(m_blockSize, 0);
            uint32_t pLen = packet->GetSize();
            if (pLen > 0) {
                packet->CopyData(payload.data(), std::min((uint32_t)m_blockSize, pLen));
            }

            double nowSec = ns3::Simulator::Now().GetSeconds();
            std::ostringstream rxOss;
            rxOss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                  << "\",\"type\":\"packet_received\",\"protocol\":\"rlnc\",\"time\":" << nowSec
                  << ",\"seq_id\":" << seqId
                  << ",\"packet_id\":" << seqId
                  << ",\"gen_id\":" << genId
                  << ",\"payload_len\":" << m_blockSize
                  << ",\"coded\":true,\"pkt_type\":\"Mixed\""
                  << ",\"coeffs\":" << VectorToJsonArray(header.GetCoefficients())
                  << ",\"data_preview\":" << PreviewToJsonArray(payload.data(), payload.size(), 6)
                  << ",\"source_node\":0,\"destination_node\":1}";
            if (m_eventCb) m_eventCb(rxOss.str());
            std::cout << rxOss.str() << std::endl;

            bool inno = dec.AddPacket(header.GetCoefficients(), payload.data(), genId, m_eventCb, m_transferId, seqId);
            if (inno) {
                m_totalInnovative++;
            } else {
                m_totalDependent++;
            }

            if (!wasComplete && dec.isComplete) {
                m_completedGenerations++;
                SendGenAck(genId, from);
            } else if (dec.isComplete) {
                SendGenAck(genId, from);
            }

        } else if (header.GetType() == PKT_RLNC_FIN) {
            m_finReceived++;
            SendFinAck(from);
            CheckOverallCompletion(from);
        }
    }
}

void RlncReceiverApplication::SendGenAck(uint16_t genId, ns3::Address from) {
    m_genAcksSent++;
    NetcodePacketHeader ackHeader;
    ackHeader.SetType(PKT_RLNC_GEN_ACK);
    ackHeader.SetTransferId(m_transferId);
    ackHeader.SetGenId(genId);
    ackHeader.SetPayloadSize(0);

    ns3::Ptr<ns3::Packet> ackPkt = ns3::Create<ns3::Packet>();
    ackPkt->AddHeader(ackHeader);

    m_socket->SendTo(ackPkt, 0, from);

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"gen_ack_sent\",\"protocol\":\"rlnc\",\"time\":" << nowSec
        << ",\"gen_id\":" << genId << "}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;
}

void RlncReceiverApplication::SendFinAck(ns3::Address from) {
    m_finAcksSent++;
    NetcodePacketHeader finAck;
    finAck.SetType(PKT_RLNC_FIN_ACK);
    finAck.SetTransferId(m_transferId);
    finAck.SetGenId(m_completedGenerations);
    finAck.SetPayloadSize(0);

    ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>();
    pkt->AddHeader(finAck);

    m_socket->SendTo(pkt, 0, from);
}

void RlncReceiverApplication::CheckOverallCompletion(ns3::Address from) {
    if (m_finished) return;

    // Check that all generations are complete
    if (m_completedGenerations < m_totalGenerations) {
        // Not all generations reached full rank K
        return;
    }

    m_finished = true;
    m_reconstructedData.clear();

    for (uint16_t g = 0; g < m_totalGenerations; g++) {
        if (m_decoders.find(g) != m_decoders.end()) {
            std::vector<std::vector<uint8_t>> recoveredBlocks;
            if (m_decoders[g].RecoverBlocks(recoveredBlocks)) {
                for (const auto &blk : recoveredBlocks) {
                    m_reconstructedData.insert(m_reconstructedData.end(), blk.begin(), blk.end());
                }
            }
        }
    }

    // Truncate zero-padding back to exact original file size
    if (m_reconstructedData.size() > m_totalFileSize) {
        m_reconstructedData.resize(m_totalFileSize);
    }

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::string hash = sha256_bytes(m_reconstructedData.data(), m_reconstructedData.size());

    std::ostringstream reconOss;
    reconOss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
             << "\",\"type\":\"reconstruction_progress\",\"protocol\":\"rlnc\",\"time\":" << nowSec
             << ",\"recovered_blocks\":" << (m_totalGenerations * m_K)
             << ",\"total_blocks\":" << (m_totalGenerations * m_K)
             << ",\"pct\":100"
             << ",\"bytes_reconstructed\":" << m_reconstructedData.size()
             << "}";
    if (m_eventCb) m_eventCb(reconOss.str());
    std::cout << reconOss.str() << std::endl;

    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"transfer_completed\",\"protocol\":\"rlnc\",\"time\":" << nowSec
        << ",\"bytes_received\":" << m_reconstructedData.size()
        << ",\"sha256\":\"" << hash << "\"}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    if (m_finishCb) {
        m_finishCb(m_reconstructedData, hash);
    }
}

} // namespace netcode
