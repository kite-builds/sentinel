// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC-8004 Identity Registry (minimal)
/// @notice Trustless registry that assigns each agent a unique on-chain id and
///         resolves between agentId, agent domain, and the agent's address.
///         Minimal subset of ERC-8004 sufficient for Sentinel to register an
///         agent identity that downstream contracts (ValidationRegistry) reference.
contract IdentityRegistry {
    struct AgentInfo {
        uint256 agentId;
        string agentDomain;
        address agentAddress;
    }

    uint256 private _agentCount;

    mapping(uint256 => AgentInfo) private _agentsById;
    mapping(string => uint256) private _idByDomain;
    mapping(address => uint256) private _idByAddress;

    event AgentRegistered(uint256 indexed agentId, string agentDomain, address indexed agentAddress);
    event AgentUpdated(uint256 indexed agentId, string agentDomain, address indexed agentAddress);

    error DomainAlreadyRegistered();
    error AddressAlreadyRegistered();
    error AgentNotFound();
    error NotAgentOwner();

    /// @notice Register a new agent. Reverts if the domain or address is taken.
    /// @param agentDomain DNS-style domain hosting the agent's metadata (AgentCard).
    /// @param agentAddress The on-chain address that controls this agent.
    /// @return agentId The newly assigned agent id (starts at 1).
    function newAgent(string calldata agentDomain, address agentAddress) external returns (uint256 agentId) {
        if (_idByDomain[agentDomain] != 0) revert DomainAlreadyRegistered();
        if (_idByAddress[agentAddress] != 0) revert AddressAlreadyRegistered();

        agentId = ++_agentCount;
        _agentsById[agentId] = AgentInfo(agentId, agentDomain, agentAddress);
        _idByDomain[agentDomain] = agentId;
        _idByAddress[agentAddress] = agentId;

        emit AgentRegistered(agentId, agentDomain, agentAddress);
    }

    /// @notice Update the domain and/or address of an existing agent.
    /// @dev Only the current agentAddress may update its record.
    function updateAgent(uint256 agentId, string calldata newDomain, address newAddress) external {
        AgentInfo storage info = _agentsById[agentId];
        if (info.agentId == 0) revert AgentNotFound();
        if (msg.sender != info.agentAddress) revert NotAgentOwner();

        if (keccak256(bytes(newDomain)) != keccak256(bytes(info.agentDomain))) {
            if (_idByDomain[newDomain] != 0) revert DomainAlreadyRegistered();
            delete _idByDomain[info.agentDomain];
            _idByDomain[newDomain] = agentId;
            info.agentDomain = newDomain;
        }

        if (newAddress != info.agentAddress) {
            if (_idByAddress[newAddress] != 0) revert AddressAlreadyRegistered();
            delete _idByAddress[info.agentAddress];
            _idByAddress[newAddress] = agentId;
            info.agentAddress = newAddress;
        }

        emit AgentUpdated(agentId, info.agentDomain, info.agentAddress);
    }

    function getAgent(uint256 agentId) external view returns (AgentInfo memory) {
        AgentInfo memory info = _agentsById[agentId];
        if (info.agentId == 0) revert AgentNotFound();
        return info;
    }

    function resolveByDomain(string calldata agentDomain) external view returns (AgentInfo memory) {
        uint256 agentId = _idByDomain[agentDomain];
        if (agentId == 0) revert AgentNotFound();
        return _agentsById[agentId];
    }

    function resolveByAddress(address agentAddress) external view returns (AgentInfo memory) {
        uint256 agentId = _idByAddress[agentAddress];
        if (agentId == 0) revert AgentNotFound();
        return _agentsById[agentId];
    }

    function agentCount() external view returns (uint256) {
        return _agentCount;
    }
}
