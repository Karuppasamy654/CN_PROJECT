#include "netcode-headers.h"

namespace netcode {

NetcodePacketHeader::NetcodePacketHeader()
    : m_magic0('N'),
      m_magic1('C'),
      m_version(1),
      m_type(0),
      m_transferId(0),
      m_seqNum(0),
      m_genId(0),
      m_K(0),
      m_coeffCount(0),
      m_payloadSize(0)
{
}

NetcodePacketHeader::~NetcodePacketHeader() {}

ns3::TypeId NetcodePacketHeader::GetTypeId() {
    static ns3::TypeId tid = ns3::TypeId("netcode::NetcodePacketHeader")
        .SetParent<ns3::Header>()
        .SetGroupName("Netcode")
        .AddConstructor<NetcodePacketHeader>();
    return tid;
}

ns3::TypeId NetcodePacketHeader::GetInstanceTypeId() const {
    return GetTypeId();
}

void NetcodePacketHeader::Print(std::ostream &os) const {
    os << "NetcodePacketHeader [type=" << (int)m_type
       << " xfer=" << m_transferId
       << " seq=" << m_seqNum
       << " gen=" << m_genId
       << " K=" << (int)m_K
       << " payloadSz=" << m_payloadSize
       << " coeffs=" << m_coeffs.size() << "]";
}

uint32_t NetcodePacketHeader::GetSerializedSize() const {
    // 2 (magic) + 1 (version) + 1 (type) + 4 (transferId) + 4 (seqNum) + 2 (genId) + 1 (K) + 1 (coeffCount) + 4 (payloadSize) = 20 bytes
    // + coeffs.size()
    return 20 + m_coeffs.size();
}


void NetcodePacketHeader::Serialize(ns3::Buffer::Iterator start) const {
    start.WriteU8(m_magic0);
    start.WriteU8(m_magic1);
    start.WriteU8(m_version);
    start.WriteU8(m_type);
    start.WriteHtonU32(m_transferId);
    start.WriteHtonU32(m_seqNum);
    start.WriteHtonU16(m_genId);
    start.WriteU8(m_K);
    start.WriteU8((uint8_t)m_coeffs.size());
    start.WriteHtonU32(m_payloadSize);

    for (uint8_t c : m_coeffs) {
        start.WriteU8(c);
    }
}

uint32_t NetcodePacketHeader::Deserialize(ns3::Buffer::Iterator start) {
    m_magic0 = start.ReadU8();
    m_magic1 = start.ReadU8();
    m_version = start.ReadU8();
    m_type = start.ReadU8();
    m_transferId = start.ReadNtohU32();
    m_seqNum = start.ReadNtohU32();
    m_genId = start.ReadNtohU16();
    m_K = start.ReadU8();
    m_coeffCount = start.ReadU8();
    m_payloadSize = start.ReadNtohU32();

    m_coeffs.clear();
    m_coeffs.resize(m_coeffCount);
    for (uint8_t i = 0; i < m_coeffCount; i++) {
        m_coeffs[i] = start.ReadU8();
    }

    return 20 + m_coeffCount;
}

} // namespace netcode

