// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @title ERC-8004 Validation Registry (minimal, audit-attestation profile)
/// @notice Anchors proof-of-task-completion for Sentinel audits. Each paid audit
///         emits an immutable record binding the audited contract, the audit
///         report hash, and a risk score to the auditor's ERC-8004 agentId.
///         A third party can later verify a delivered report against its on-chain
///         hash, and read the auditor's historical track record.
contract ValidationRegistry {
    IdentityRegistry public immutable identity;

    struct AuditRecord {
        uint256 auditorAgentId;
        bytes32 subjectHash; // keccak256 of the audited contract address+chainId or bytecode
        bytes32 reportHash; // keccak256 of the canonical JSON audit report
        uint8 riskScore; // 0 (clean) .. 100 (critical)
        uint64 timestamp;
    }

    AuditRecord[] private _records;
    mapping(uint256 => uint256[]) private _recordsByAuditor;
    mapping(bytes32 => uint256[]) private _recordsBySubject;

    event AuditRecorded(
        uint256 indexed recordId,
        uint256 indexed auditorAgentId,
        bytes32 indexed subjectHash,
        bytes32 reportHash,
        uint8 riskScore
    );

    error UnknownAuditor();
    error NotAuditorAddress();
    error RiskScoreOutOfRange();

    constructor(address identityRegistry) {
        identity = IdentityRegistry(identityRegistry);
    }

    /// @notice Record an audit. Caller must be the registered address of the auditor agent.
    /// @param auditorAgentId ERC-8004 id of the agent that produced the audit.
    /// @param subjectHash Identifier of what was audited (e.g. keccak256(abi.encode(target, chainId))).
    /// @param reportHash keccak256 of the full audit report the auditor delivered off-chain.
    /// @param riskScore Aggregate risk score 0..100.
    /// @return recordId Index of the stored record.
    function recordAudit(
        uint256 auditorAgentId,
        bytes32 subjectHash,
        bytes32 reportHash,
        uint8 riskScore
    ) external returns (uint256 recordId) {
        if (riskScore > 100) revert RiskScoreOutOfRange();

        IdentityRegistry.AgentInfo memory info = identity.getAgent(auditorAgentId);
        if (info.agentId == 0) revert UnknownAuditor();
        if (msg.sender != info.agentAddress) revert NotAuditorAddress();

        recordId = _records.length;
        _records.push(
            AuditRecord({
                auditorAgentId: auditorAgentId,
                subjectHash: subjectHash,
                reportHash: reportHash,
                riskScore: riskScore,
                timestamp: uint64(block.timestamp)
            })
        );
        _recordsByAuditor[auditorAgentId].push(recordId);
        _recordsBySubject[subjectHash].push(recordId);

        emit AuditRecorded(recordId, auditorAgentId, subjectHash, reportHash, riskScore);
    }

    /// @notice Verify that a given report hash was anchored for a subject by an auditor.
    function verify(uint256 auditorAgentId, bytes32 subjectHash, bytes32 reportHash) external view returns (bool) {
        uint256[] storage ids = _recordsBySubject[subjectHash];
        for (uint256 i = 0; i < ids.length; i++) {
            AuditRecord storage r = _records[ids[i]];
            if (r.auditorAgentId == auditorAgentId && r.reportHash == reportHash) {
                return true;
            }
        }
        return false;
    }

    function getRecord(uint256 recordId) external view returns (AuditRecord memory) {
        return _records[recordId];
    }

    function recordCount() external view returns (uint256) {
        return _records.length;
    }

    function auditorRecordIds(uint256 auditorAgentId) external view returns (uint256[] memory) {
        return _recordsByAuditor[auditorAgentId];
    }

    function subjectRecordIds(bytes32 subjectHash) external view returns (uint256[] memory) {
        return _recordsBySubject[subjectHash];
    }
}
