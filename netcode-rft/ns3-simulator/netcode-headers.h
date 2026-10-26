#ifndef NETCODE_NS3_HEADERS_H
#define NETCODE_NS3_HEADERS_H

#include "ns3/header.h"
#include <vector>
#include <string>

namespace netcode {

enum PacketType : uint8_t {
    PKT_DATA = 1,
    PKT_ACK = 2,
    PKT_FIN = 3,
    PKT_FIN_ACK = 4,
    PKT_RLNC_SYSTEMATIC = 5,
    PKT_RLNC_CODED = 6,
    PKT_RLNC_GEN_ACK = 7,
    PKT_RLNC_FIN = 8,
    PKT_RLNC_FIN_ACK = 9
};

class NetcodePacketHeader : public ns3::Header {
public:
    NetcodePacketHeader();
    virtual ~NetcodePacketHeader();

    static ns3::TypeId GetTypeId();
    virtual ns3::TypeId GetInstanceTypeId() const override;
    virtual void Print(std::ostream &os) const override;
    virtual uint32_t GetSerializedSize() const override;
    virtual void Serialize(ns3::Buffer::Iterator start) const override;
    virtual uint32_t Deserialize(ns3::Buffer::Iterator start) override;

    void SetMagic(uint8_t m0, uint8_t m1) { m_magic0 = m0; m_magic1 = m1; }
    void SetVersion(uint8_t v) { m_version = v; }
    void SetType(PacketType t) { m_type = (uint8_t)t; }
    void SetTransferId(uint32_t id) { m_transferId = id; }
    void SetSeqNum(uint32_t seq) { m_seqNum = seq; }
    void SetGenId(uint16_t gen) { m_genId = gen; }
    void SetK(uint8_t k) { m_K = k; }
    void SetPayloadSize(uint32_t sz) { m_payloadSize = sz; }
    void SetCoefficients(const std::vector<uint8_t> &coeffs) {
        m_coeffs = coeffs;
    }

    uint8_t GetType() const { return m_type; }
    uint32_t GetTransferId() const { return m_transferId; }
    uint32_t GetSeqNum() const { return m_seqNum; }
    uint16_t GetGenId() const { return m_genId; }
    uint8_t GetK() const { return m_K; }
    uint32_t GetPayloadSize() const { return m_payloadSize; }
    const std::vector<uint8_t>& GetCoefficients() const { return m_coeffs; }
    bool IsValid() const { return m_magic0 == 'N' && m_magic1 == 'C' && m_version == 1; }

private:
    uint8_t m_magic0;
    uint8_t m_magic1;
    uint8_t m_version;
    uint8_t m_type;
    uint32_t m_transferId;
    uint32_t m_seqNum;
    uint16_t m_genId;
    uint8_t m_K;
    uint8_t m_coeffCount;
    uint32_t m_payloadSize;
    std::vector<uint8_t> m_coeffs;
};

} // namespace netcode

#endif // NETCODE_NS3_HEADERS_H
