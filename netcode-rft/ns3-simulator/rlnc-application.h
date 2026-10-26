#ifndef NETCODE_NS3_RLNC_APPLICATION_H
#define NETCODE_NS3_RLNC_APPLICATION_H

#include "ns3/application.h"
#include "ns3/socket.h"
#include "ns3/address.h"
#include "ns3/event-id.h"
#include "ns3/nstime.h"
#include "netcode-headers.h"
#include "gf256.h"
#include <vector>
#include <string>
#include <map>

namespace netcode {

class RlncSenderApplication : public ns3::Application {
public:
    static ns3::TypeId GetTypeId();
    RlncSenderApplication();
    virtual ~RlncSenderApplication();

    void Setup(ns3::Ptr<ns3::Socket> socket, ns3::Address peerAddress,
               const std::vector<uint8_t> &data, uint32_t blockSize,
               uint8_t K, uint32_t redundancy, ns3::Time packetInterval,
               uint32_t transferId);

    void SetCallbacks(std::function<void(const std::string&)> eventCb,
                      std::function<void(bool success, double timeSec, uint32_t sent, uint32_t coded, uint32_t genAcks)> metricsCb);

    uint32_t GetSystematicSent() const { return m_systematicSent; }
    uint32_t GetCodedSent() const { return m_codedSent; }
    uint32_t GetRepairBurstSent() const { return m_repairBurstSent; }
    uint32_t GetDataPacketsSent() const { return m_systematicSent + m_codedSent + m_repairBurstSent; }
    uint32_t GetFinSent() const { return m_finSent; }
    uint32_t GetTotalSent() const { return GetDataPacketsSent() + m_finSent; }
    uint32_t GetGenAcksReceived() const { return m_genAcksReceived; }
    uint32_t GetFinAcksReceived() const { return m_finAcksReceived; }

protected:
    virtual void StartApplication() override;
    virtual void StopApplication() override;

private:
    void SendNextPacket();
    void SendGenerationPackets(uint16_t genId);
    void SendFin();
    void HandleRead(ns3::Ptr<ns3::Socket> socket);
    void OnGenTimeout(uint16_t genId);

    ns3::Ptr<ns3::Socket> m_socket;
    ns3::Address m_peerAddress;
    std::vector<uint8_t> m_data;
    uint32_t m_blockSize;
    uint8_t m_K;
    uint32_t m_redundancy;
    ns3::Time m_packetInterval;
    uint32_t m_transferId;

    uint16_t m_currentGen;
    uint16_t m_totalGenerations;
    uint32_t m_packetsSentInGen;
    uint32_t m_systematicSent;
    uint32_t m_codedSent;
    uint32_t m_repairBurstSent;
    uint32_t m_finSent;
    uint32_t m_genAcksReceived;
    uint32_t m_finAcksReceived;
    ns3::EventId m_sendNextEvent;
    ns3::EventId m_genTimeoutEvent;
    ns3::Time m_startTime;
    bool m_finished;

    // Cache of source blocks per generation
    std::vector<std::vector<std::vector<uint8_t>>> m_genBlocks; // [gen][blk][bytes]

    std::function<void(const std::string&)> m_eventCb;
    std::function<void(bool, double, uint32_t, uint32_t, uint32_t)> m_metricsCb;
};

// Decoder state for a single generation
struct RlncGenDecoder {
    uint8_t K;
    uint32_t blockSize;
    int rank;
    uint32_t innovativeCount;
    uint32_t dependentCount;
    bool isComplete;

    // Augmented matrix: K rows x (K coeffs + blockSize payload)
    std::vector<std::vector<uint8_t>> matrix;
    std::vector<bool> hasRow;

    RlncGenDecoder(uint8_t k = 4, uint32_t bSize = 1024);
    bool AddPacket(const std::vector<uint8_t> &coeffs, const uint8_t *payload, uint16_t genId,
                   std::function<void(const std::string&)> eventCb, uint32_t transferId);
    bool RecoverBlocks(std::vector<std::vector<uint8_t>> &recoveredBlocks);
};

class RlncReceiverApplication : public ns3::Application {
public:
    static ns3::TypeId GetTypeId();
    RlncReceiverApplication();
    virtual ~RlncReceiverApplication();

    void Setup(ns3::Ptr<ns3::Socket> socket, uint32_t totalFileSize,
               uint32_t blockSize, uint8_t K, uint32_t transferId);
    void SetCallbacks(std::function<void(const std::string&)> eventCb,
                      std::function<void(const std::vector<uint8_t>&, const std::string& sha256)> finishCb);

    const std::vector<uint8_t>& GetReconstructedData() const { return m_reconstructedData; }
    uint32_t GetDataPacketsReceived() const { return m_systematicReceived + m_codedReceived; }
    uint32_t GetSystematicReceived() const { return m_systematicReceived; }
    uint32_t GetCodedReceived() const { return m_codedReceived; }
    uint32_t GetFinReceived() const { return m_finReceived; }
    uint32_t GetGenAcksSent() const { return m_genAcksSent; }
    uint32_t GetFinAcksSent() const { return m_finAcksSent; }
    uint32_t GetTotalReceived() const { return GetDataPacketsReceived() + m_finReceived; }
    uint32_t GetTotalInnovative() const { return m_totalInnovative; }
    uint32_t GetTotalDependent() const { return m_totalDependent; }
    uint16_t GetDecodedGenerations() const { return m_completedGenerations; }

protected:
    virtual void StartApplication() override;
    virtual void StopApplication() override;

private:
    void HandleRead(ns3::Ptr<ns3::Socket> socket);
    void SendGenAck(uint16_t genId, ns3::Address from);
    void SendFinAck(ns3::Address from);
    void CheckOverallCompletion(ns3::Address from);

    ns3::Ptr<ns3::Socket> m_socket;
    uint32_t m_totalFileSize;
    uint32_t m_blockSize;
    uint8_t m_K;
    uint32_t m_transferId;

    uint16_t m_totalGenerations;
    uint16_t m_completedGenerations;
    uint32_t m_systematicReceived;
    uint32_t m_codedReceived;
    uint32_t m_finReceived;
    uint32_t m_genAcksSent;
    uint32_t m_finAcksSent;
    uint32_t m_totalInnovative;
    uint32_t m_totalDependent;
    bool m_finished;

    std::map<uint16_t, RlncGenDecoder> m_decoders;
    std::vector<uint8_t> m_reconstructedData;

    std::function<void(const std::string&)> m_eventCb;
    std::function<void(const std::vector<uint8_t>&, const std::string&)> m_finishCb;
};

} // namespace netcode

#endif // NETCODE_NS3_RLNC_APPLICATION_H
