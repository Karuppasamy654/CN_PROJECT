#ifndef NETCODE_NS3_RUDP_APPLICATION_H
#define NETCODE_NS3_RUDP_APPLICATION_H

#include "ns3/application.h"
#include "ns3/socket.h"
#include "ns3/address.h"
#include "ns3/event-id.h"
#include "ns3/nstime.h"
#include "netcode-headers.h"
#include <vector>
#include <string>

namespace netcode {

class RudpSenderApplication : public ns3::Application {
public:
    static ns3::TypeId GetTypeId();
    RudpSenderApplication();
    virtual ~RudpSenderApplication();

    void Setup(ns3::Ptr<ns3::Socket> socket, ns3::Address peerAddress,
               const std::vector<uint8_t> &data, uint32_t blockSize,
               ns3::Time timeout, uint32_t maxRetries, uint32_t transferId);

    void SetCallbacks(std::function<void(const std::string&)> eventCb,
                      std::function<void(bool success, double timeSec, uint32_t sent, uint32_t retries, uint32_t acks)> metricsCb);

    uint32_t GetDataPacketsSent() const { return m_initialDataSent + m_totalRetries; }
    uint32_t GetInitialDataSent() const { return m_initialDataSent; }
    uint32_t GetRetransmissionsSent() const { return m_totalRetries; }
    uint32_t GetFinSent() const { return m_finSent; }
    uint32_t GetTotalSent() const { return GetDataPacketsSent() + m_finSent; }
    uint32_t GetDataAcksReceived() const { return m_totalAcks; }
    uint32_t GetFinAcksReceived() const { return m_finAcksReceived; }

protected:
    virtual void StartApplication() override;
    virtual void StopApplication() override;

private:
    void SendPacket(uint32_t seq);
    void SendFin();
    void HandleRead(ns3::Ptr<ns3::Socket> socket);
    void OnTimeout(uint32_t seq);

    ns3::Ptr<ns3::Socket> m_socket;
    ns3::Address m_peerAddress;
    std::vector<uint8_t> m_data;
    uint32_t m_blockSize;
    ns3::Time m_timeout;
    uint32_t m_maxRetries;
    uint32_t m_transferId;

    uint32_t m_currentSeq;
    uint32_t m_totalPackets;
    uint32_t m_retryCount;
    ns3::EventId m_timeoutEvent;

    // Metrics
    uint32_t m_initialDataSent;
    uint32_t m_totalRetries;
    uint32_t m_finSent;
    uint32_t m_totalAcks;
    uint32_t m_finAcksReceived;
    ns3::Time m_startTime;
    bool m_finished;

    std::function<void(const std::string&)> m_eventCb;
    std::function<void(bool, double, uint32_t, uint32_t, uint32_t)> m_metricsCb;
};

class RudpReceiverApplication : public ns3::Application {
public:
    static ns3::TypeId GetTypeId();
    RudpReceiverApplication();
    virtual ~RudpReceiverApplication();

    void Setup(ns3::Ptr<ns3::Socket> socket, uint32_t transferId);
    void SetCallbacks(std::function<void(const std::string&)> eventCb,
                      std::function<void(const std::vector<uint8_t>&, const std::string& sha256)> finishCb);

    const std::vector<uint8_t>& GetReceivedData() const { return m_receivedData; }
    uint32_t GetDataPacketsReceived() const { return m_uniqueDataReceived + m_duplicateCount; }
    uint32_t GetUniqueDataReceived() const { return m_uniqueDataReceived; }
    uint32_t GetDuplicateCount() const { return m_duplicateCount; }
    uint32_t GetFinReceived() const { return m_finReceived; }
    uint32_t GetDataAcksSent() const { return m_dataAcksSent; }
    uint32_t GetFinAcksSent() const { return m_finAcksSent; }
    uint32_t GetTotalReceivedPackets() const { return GetDataPacketsReceived() + m_finReceived; }

protected:
    virtual void StartApplication() override;
    virtual void StopApplication() override;

private:
    void HandleRead(ns3::Ptr<ns3::Socket> socket);
    void SendAck(uint32_t seq, ns3::Address from);
    void SendFinAck(ns3::Address from);

    ns3::Ptr<ns3::Socket> m_socket;
    uint32_t m_transferId;
    uint32_t m_expectedSeq;
    std::vector<uint8_t> m_receivedData;

    uint32_t m_uniqueDataReceived;
    uint32_t m_duplicateCount;
    uint32_t m_finReceived;
    uint32_t m_dataAcksSent;
    uint32_t m_finAcksSent;
    bool m_finished;

    std::function<void(const std::string&)> m_eventCb;
    std::function<void(const std::vector<uint8_t>&, const std::string&)> m_finishCb;
};

} // namespace netcode

#endif // NETCODE_NS3_RUDP_APPLICATION_H
