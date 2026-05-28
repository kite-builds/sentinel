// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IdentityRegistry} from "../IdentityRegistry.sol";
import {ValidationRegistry} from "../ValidationRegistry.sol";

/// @notice Deploys the Sentinel ERC-8004 registries and registers the Sentinel agent.
/// Env:
///   PRIVATE_KEY     - deployer key (also becomes Sentinel's agent address)
///   SENTINEL_DOMAIN - agent domain hosting the AgentCard (default "sentinel.audit")
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        string memory domain = vm.envOr("SENTINEL_DOMAIN", string("sentinel.audit"));
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        IdentityRegistry identity = new IdentityRegistry();
        ValidationRegistry validation = new ValidationRegistry(address(identity));
        uint256 agentId = identity.newAgent(domain, deployer);

        vm.stopBroadcast();

        console2.log("IdentityRegistry:  ", address(identity));
        console2.log("ValidationRegistry:", address(validation));
        console2.log("Sentinel agentId:  ", agentId);
        console2.log("Sentinel address:  ", deployer);
    }
}
