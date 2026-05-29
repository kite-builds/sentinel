/** Minimal ABIs for Sentinel's ERC-8004 registries. */

export const IDENTITY_REGISTRY_ABI = [
  "function newAgent(string agentDomain, address agentAddress) returns (uint256)",
  "function getAgent(uint256 agentId) view returns (tuple(uint256 agentId, string agentDomain, address agentAddress))",
  "function resolveByDomain(string agentDomain) view returns (tuple(uint256 agentId, string agentDomain, address agentAddress))",
  "function resolveByAddress(address agentAddress) view returns (tuple(uint256 agentId, string agentDomain, address agentAddress))",
  "function agentCount() view returns (uint256)",
  "event AgentRegistered(uint256 indexed agentId, string agentDomain, address indexed agentAddress)",
];

export const VALIDATION_REGISTRY_ABI = [
  "function recordAudit(uint256 auditorAgentId, bytes32 subjectHash, bytes32 reportHash, uint8 riskScore) returns (uint256)",
  "function verify(uint256 auditorAgentId, bytes32 subjectHash, bytes32 reportHash) view returns (bool)",
  "function getRecord(uint256 recordId) view returns (tuple(uint256 auditorAgentId, bytes32 subjectHash, bytes32 reportHash, uint8 riskScore, uint64 timestamp))",
  "function recordCount() view returns (uint256)",
  "function auditorRecordIds(uint256 auditorAgentId) view returns (uint256[])",
  "event AuditRecorded(uint256 indexed recordId, uint256 indexed auditorAgentId, bytes32 indexed subjectHash, bytes32 reportHash, uint8 riskScore)",
];
