#include "rudp-application.h"
#include "ns3/log.h"
#include "ns3/simulator.h"
#include "ns3/inet-socket-address.h"
#include "sha256.h"
#include <iostream>
#include <sstream>

namespace netcode {

NS_LOG_COMPONENT_DEFINE("NetcodeRudpApplication");

// ---------------- RudpSenderApplication ----------------

ns3::TypeId RudpSenderApplication::GetTypeId() {
    static ns3::TypeId tid = ns3::TypeId("netcode::RudpSenderApplication")
        .SetParent<ns3::Application>()
        .SetGroupName("Netcode")
        .AddConstructor<RudpSenderApplication>();
    return tid;
}

RudpSenderApplication::RudpSenderApplication()
    : m_blockSize(1024),
      m_timeout(ns3::MilliSeconds(200)),
      m_maxRetries(10),
      m_transferId(1),
      m_currentSeq(0),
      m_totalPackets(0),
      m_retryCount(0),
      m_initialDataSent(0),
      m_dataRetransmissions(0),
      m_finRetransmissions(0),
      m_totalRetries(0),
      m_finSent(0),
      m_totalAcks(0),
      m_finAcksReceived(0),
      m_finished(false)
{
}

RudpSenderApplication::~RudpSenderApplication() {
    m_socket = nullptr;
}

void RudpSenderApplication::Setup(ns3::Ptr<ns3::Socket> socket, ns3::Address peerAddress,
                                  const std::vector<uint8_t> &data, uint32_t blockSize,
                                  ns3::Time timeout, uint32_t maxRetries, uint32_t transferId) {
    m_socket = socket;
    m_peerAddress = peerAddress;
    m_data = data;
    m_blockSize = blockSize;
    m_timeout = timeout;
    m_maxRetries = maxRetries;
    m_transferId = transferId;

    if (m_data.empty()) {
        m_totalPackets = 0;
    } else {
        m_totalPackets = (m_data.size() + m_blockSize - 1) / m_blockSize;
    }
}

void RudpSenderApplication::SetCallbacks(
    std::function<void(const std::string&)> eventCb,
    std::function<void(bool, double, uint32_t, uint32_t, uint32_t)> metricsCb) {
    m_eventCb = eventCb;
    m_metricsCb = metricsCb;
}

void RudpSenderApplication::StartApplication() {
    m_socket->SetRecvCallback(ns3::MakeCallback(&RudpSenderApplication::HandleRead, this));
    m_startTime = ns3::Simulator::Now();
    m_currentSeq = 0;
    m_retryCount = 0;
    m_finished = false;

    if (m_totalPackets == 0) {
        SendFin();
        return;
    }

    // Send first packet
    SendPacket(m_currentSeq);
}

void RudpSenderApplication::StopApplication() {
    if (m_timeoutEvent.IsRunning()) {
        m_timeoutEvent.Cancel();
    }
    if (m_socket) {
        m_socket->Close();
    }
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

void RudpSenderApplication::SendPacket(uint32_t seq) {
    if (seq >= m_totalPackets) {
        SendFin();
        return;
    }

    size_t offset = seq * m_blockSize;
    size_t len = 0;
    if (offset < m_data.size()) {
        len = std::min((size_t)m_blockSize, m_data.size() - offset);
    }

    NetcodePacketHeader header;
    header.SetType(PKT_DATA);
    header.SetTransferId(m_transferId);
    header.SetSeqNum(seq);
    header.SetPayloadSize(len);

    ns3::Ptr<ns3::Packet> pkt;
    if (len > 0) {
        pkt = ns3::Create<ns3::Packet>(&m_data[offset], len);
    } else {
        pkt = ns3::Create<ns3::Packet>();
    }
    pkt->AddHeader(header);

    m_socket->SendTo(pkt, 0, m_peerAddress);
    if (m_retryCount == 0) {
        m_initialDataSent++;
    }

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"packet_transmitted\",\"protocol\":\"rudp\",\"time\":" << nowSec
        << ",\"seq_id\":" << seq
        << ",\"packet_id\":" << seq
        << ",\"retry\":" << m_retryCount
        << ",\"is_retransmit\":" << (m_retryCount > 0 ? "true" : "false")
        << ",\"pkt_type\":\"" << (m_retryCount > 0 ? "Retransmit" : "Data") << "\""
        << ",\"payload_len\":" << len
        << ",\"data_preview\":" << (len > 0 ? PreviewToJsonArray(&m_data[offset], len, 6) : "[]")
        << ",\"source_node\":0,\"destination_node\":1}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    // Schedule retransmission timeout
    if (m_timeoutEvent.IsRunning()) {
        m_timeoutEvent.Cancel();
    }
    m_timeoutEvent = ns3::Simulator::Schedule(m_timeout, &RudpSenderApplication::OnTimeout, this, seq);
}

void RudpSenderApplication::OnTimeout(uint32_t seq) {
    if (m_finished) return;

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"rudp_timeout\",\"protocol\":\"rudp\",\"time\":" << nowSec
        << ",\"seq_id\":" << seq << ",\"retry_count\":" << (m_retryCount + 1)
        << ",\"max_retries\":" << m_maxRetries << "}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    if (m_retryCount < m_maxRetries) {
        m_retryCount++;
        m_totalRetries++;

        std::ostringstream retryOss;
        retryOss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                 << "\",\"type\":\"rudp_retransmit\",\"protocol\":\"rudp\",\"time\":" << nowSec
                 << ",\"seq_id\":" << seq << ",\"retry_number\":" << m_retryCount << "}";
        if (m_eventCb) m_eventCb(retryOss.str());
        std::cout << retryOss.str() << std::endl;

        if (seq < m_totalPackets) {
            m_dataRetransmissions++;
            SendPacket(seq);
        } else {
            m_finRetransmissions++;
            SendFin();
        }
    } else {
        // Max retries exceeded -> failure
        m_finished = true;
        std::ostringstream failOss;
        failOss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                << "\",\"type\":\"transfer_failed\",\"protocol\":\"rudp\",\"time\":" << nowSec
                << ",\"reason\":\"Max retries exceeded on seq " << seq << "\"}";
        if (m_eventCb) m_eventCb(failOss.str());
        std::cout << failOss.str() << std::endl;

        if (m_metricsCb) {
            m_metricsCb(false, nowSec - m_startTime.GetSeconds(), GetTotalSent(), m_totalRetries, m_totalAcks);
        }
    }
}

void RudpSenderApplication::SendFin() {
    NetcodePacketHeader header;
    header.SetType(PKT_FIN);
    header.SetTransferId(m_transferId);
    header.SetSeqNum(m_totalPackets);
    header.SetPayloadSize(0);

    ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>();
    pkt->AddHeader(header);

    m_socket->SendTo(pkt, 0, m_peerAddress);
    m_finSent++;

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"fin_sent\",\"protocol\":\"rudp\",\"time\":" << nowSec
        << ",\"seq_id\":" << m_totalPackets << "}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;

    if (m_timeoutEvent.IsRunning()) {
        m_timeoutEvent.Cancel();
    }
    m_timeoutEvent = ns3::Simulator::Schedule(m_timeout, &RudpSenderApplication::OnTimeout, this, m_totalPackets);
}

void RudpSenderApplication::HandleRead(ns3::Ptr<ns3::Socket> socket) {
    ns3::Ptr<ns3::Packet> packet;
    ns3::Address from;
    while ((packet = socket->RecvFrom(from))) {
        NetcodePacketHeader header;
        packet->RemoveHeader(header);

        if (!header.IsValid() || header.GetTransferId() != m_transferId) {
            continue;
        }

        double nowSec = ns3::Simulator::Now().GetSeconds();

        if (header.GetType() == PKT_ACK) {
            uint32_t ackSeq = header.GetSeqNum();
            m_totalAcks++;

            std::ostringstream oss;
            oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                << "\",\"type\":\"ack_received\",\"protocol\":\"rudp\",\"time\":" << nowSec
                << ",\"ack_seq\":" << ackSeq << ",\"expected_seq\":" << m_currentSeq << "}";
            if (m_eventCb) m_eventCb(oss.str());
            std::cout << oss.str() << std::endl;

            if (ackSeq == m_currentSeq) {
                if (m_timeoutEvent.IsRunning()) {
                    m_timeoutEvent.Cancel();
                }
                m_currentSeq++;
                m_retryCount = 0;

                if (m_currentSeq < m_totalPackets) {
                    SendPacket(m_currentSeq);
                } else {
                    SendFin();
                }
            }
        } else if (header.GetType() == PKT_FIN_ACK) {
            m_finAcksReceived++;
            if (m_timeoutEvent.IsRunning()) {
                m_timeoutEvent.Cancel();
            }
            m_finished = true;

            std::ostringstream oss;
            oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                << "\",\"type\":\"fin_ack_received\",\"protocol\":\"rudp\",\"time\":" << nowSec << "}";
            if (m_eventCb) m_eventCb(oss.str());
            std::cout << oss.str() << std::endl;

            double elapsedSec = nowSec - m_startTime.GetSeconds();
            if (m_metricsCb) {
                m_metricsCb(true, elapsedSec, GetDataPacketsSent(), m_totalRetries, m_totalAcks);
            }
        }
    }
}

// ---------------- RudpReceiverApplication ----------------

ns3::TypeId RudpReceiverApplication::GetTypeId() {
    static ns3::TypeId tid = ns3::TypeId("netcode::RudpReceiverApplication")
        .SetParent<ns3::Application>()
        .SetGroupName("Netcode")
        .AddConstructor<RudpReceiverApplication>();
    return tid;
}

RudpReceiverApplication::RudpReceiverApplication()
    : m_transferId(1),
      m_expectedSeq(0),
      m_uniqueDataReceived(0),
      m_duplicateCount(0),
      m_finReceived(0),
      m_dataAcksSent(0),
      m_finAcksSent(0),
      m_finished(false)
{
}

RudpReceiverApplication::~RudpReceiverApplication() {
    m_socket = nullptr;
}

void RudpReceiverApplication::Setup(ns3::Ptr<ns3::Socket> socket, uint32_t transferId) {
    m_socket = socket;
    m_transferId = transferId;
    m_expectedSeq = 0;
    m_uniqueDataReceived = 0;
    m_duplicateCount = 0;
    m_finReceived = 0;
    m_dataAcksSent = 0;
    m_finAcksSent = 0;
    m_finished = false;
    m_receivedData.clear();
}

void RudpReceiverApplication::SetCallbacks(
    std::function<void(const std::string&)> eventCb,
    std::function<void(const std::vector<uint8_t>&, const std::string&)> finishCb) {
    m_eventCb = eventCb;
    m_finishCb = finishCb;
}

void RudpReceiverApplication::StartApplication() {
    m_socket->SetRecvCallback(ns3::MakeCallback(&RudpReceiverApplication::HandleRead, this));
}

void RudpReceiverApplication::StopApplication() {
    if (m_socket) {
        m_socket->Close();
    }
}

void RudpReceiverApplication::HandleRead(ns3::Ptr<ns3::Socket> socket) {
    ns3::Ptr<ns3::Packet> packet;
    ns3::Address from;
    while ((packet = socket->RecvFrom(from))) {
        NetcodePacketHeader header;
        packet->RemoveHeader(header);

        if (!header.IsValid() || header.GetTransferId() != m_transferId) {
            continue;
        }

        double nowSec = ns3::Simulator::Now().GetSeconds();

        if (header.GetType() == PKT_DATA) {
            uint32_t seq = header.GetSeqNum();
            uint32_t pLen = header.GetPayloadSize();

            if (seq == m_expectedSeq) {
                // In-order expected packet
                m_uniqueDataReceived++;
                std::vector<uint8_t> payload(pLen);
                if (pLen > 0) {
                    packet->CopyData(payload.data(), pLen);
                    m_receivedData.insert(m_receivedData.end(), payload.begin(), payload.end());
                }

                std::ostringstream oss;
                oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                    << "\",\"type\":\"packet_received\",\"protocol\":\"rudp\",\"time\":" << nowSec
                    << ",\"seq_id\":" << seq
                    << ",\"packet_id\":" << seq
                    << ",\"payload_len\":" << pLen
                    << ",\"duplicate\":false,\"pkt_type\":\"Data\""
                    << ",\"data_preview\":" << (pLen > 0 ? PreviewToJsonArray(payload.data(), pLen, 6) : "[]")
                    << ",\"source_node\":0,\"destination_node\":1}";
                if (m_eventCb) m_eventCb(oss.str());
                std::cout << oss.str() << std::endl;

                m_expectedSeq++;
                SendAck(seq, from);
            } else if (seq < m_expectedSeq) {
                // Duplicate packet already received
                m_duplicateCount++;
                std::vector<uint8_t> payload(pLen);
                if (pLen > 0) {
                    packet->CopyData(payload.data(), pLen);
                }

                std::ostringstream oss;
                oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                    << "\",\"type\":\"packet_received\",\"protocol\":\"rudp\",\"time\":" << nowSec
                    << ",\"seq_id\":" << seq
                    << ",\"packet_id\":" << seq
                    << ",\"payload_len\":" << pLen
                    << ",\"duplicate\":true,\"pkt_type\":\"Duplicate\""
                    << ",\"data_preview\":" << (pLen > 0 ? PreviewToJsonArray(payload.data(), pLen, 6) : "[]")
                    << ",\"source_node\":0,\"destination_node\":1}";
                if (m_eventCb) m_eventCb(oss.str());
                std::cout << oss.str() << std::endl;

                // Re-send ACK for previous packet so sender advances
                SendAck(seq, from);
            }
        } else if (header.GetType() == PKT_FIN) {
            m_finReceived++;
            SendFinAck(from);

            if (!m_finished) {
                m_finished = true;
                std::string hash = sha256_bytes(m_receivedData.data(), m_receivedData.size());

                std::ostringstream reconOss;
                reconOss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                         << "\",\"type\":\"reconstruction_progress\",\"protocol\":\"rudp\",\"time\":" << nowSec
                         << ",\"recovered_blocks\":" << m_uniqueDataReceived
                         << ",\"total_blocks\":" << m_uniqueDataReceived
                         << ",\"pct\":100"
                         << ",\"bytes_reconstructed\":" << m_receivedData.size()
                         << "}";
                if (m_eventCb) m_eventCb(reconOss.str());
                std::cout << reconOss.str() << std::endl;

                std::ostringstream oss;
                oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
                    << "\",\"type\":\"transfer_completed\",\"protocol\":\"rudp\",\"time\":" << nowSec
                    << ",\"bytes_received\":" << m_receivedData.size()
                    << ",\"sha256\":\"" << hash << "\"}";
                if (m_eventCb) m_eventCb(oss.str());
                std::cout << oss.str() << std::endl;

                if (m_finishCb) {
                    m_finishCb(m_receivedData, hash);
                }
            }
        }
    }
}

void RudpReceiverApplication::SendAck(uint32_t seq, ns3::Address from) {
    m_dataAcksSent++;
    NetcodePacketHeader ackHeader;
    ackHeader.SetType(PKT_ACK);
    ackHeader.SetTransferId(m_transferId);
    ackHeader.SetSeqNum(seq);
    ackHeader.SetPayloadSize(0);

    ns3::Ptr<ns3::Packet> ackPkt = ns3::Create<ns3::Packet>();
    ackPkt->AddHeader(ackHeader);

    m_socket->SendTo(ackPkt, 0, from);

    double nowSec = ns3::Simulator::Now().GetSeconds();
    std::ostringstream oss;
    oss << "EVENT_JSON:{\"transfer_id\":\"" << m_transferId
        << "\",\"type\":\"ack_sent\",\"protocol\":\"rudp\",\"time\":" << nowSec
        << ",\"seq_id\":" << seq
        << ",\"ack_seq\":" << seq
        << ",\"source_node\":1,\"destination_node\":0}";
    if (m_eventCb) m_eventCb(oss.str());
    std::cout << oss.str() << std::endl;
}

void RudpReceiverApplication::SendFinAck(ns3::Address from) {
    m_finAcksSent++;
    NetcodePacketHeader finAck;
    finAck.SetType(PKT_FIN_ACK);
    finAck.SetTransferId(m_transferId);
    finAck.SetSeqNum(m_expectedSeq);
    finAck.SetPayloadSize(0);

    ns3::Ptr<ns3::Packet> pkt = ns3::Create<ns3::Packet>();
    pkt->AddHeader(finAck);

    m_socket->SendTo(pkt, 0, from);
}

} // namespace netcode
