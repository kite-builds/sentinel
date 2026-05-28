// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../IdentityRegistry.sol";
import {ValidationRegistry} from "../ValidationRegistry.sol";

contract RegistriesTest is Test {
    IdentityRegistry identity;
    ValidationRegistry validation;

    address sentinel = address(0x5E471);
    address other = address(0xBEEF);

    function setUp() public {
        identity = new IdentityRegistry();
        validation = new ValidationRegistry(address(identity));
    }

    function test_RegisterAssignsSequentialIds() public {
        uint256 id1 = identity.newAgent("sentinel.audit", sentinel);
        uint256 id2 = identity.newAgent("other.agent", other);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(identity.agentCount(), 2);
        assertEq(identity.resolveByAddress(sentinel).agentId, 1);
        assertEq(identity.resolveByDomain("sentinel.audit").agentAddress, sentinel);
    }

    function test_DuplicateDomainReverts() public {
        identity.newAgent("sentinel.audit", sentinel);
        vm.expectRevert(IdentityRegistry.DomainAlreadyRegistered.selector);
        identity.newAgent("sentinel.audit", other);
    }

    function test_DuplicateAddressReverts() public {
        identity.newAgent("sentinel.audit", sentinel);
        vm.expectRevert(IdentityRegistry.AddressAlreadyRegistered.selector);
        identity.newAgent("another.domain", sentinel);
    }

    function test_RecordAndVerifyAudit() public {
        uint256 agentId = identity.newAgent("sentinel.audit", sentinel);
        bytes32 subject = keccak256(abi.encode(address(0x1234), uint256(5003)));
        bytes32 report = keccak256("report-json-v1");

        vm.prank(sentinel);
        uint256 recordId = validation.recordAudit(agentId, subject, report, 73);

        assertEq(recordId, 0);
        assertEq(validation.recordCount(), 1);
        assertTrue(validation.verify(agentId, subject, report));
        assertFalse(validation.verify(agentId, subject, keccak256("tampered")));

        ValidationRegistry.AuditRecord memory r = validation.getRecord(0);
        assertEq(r.riskScore, 73);
        assertEq(r.reportHash, report);
    }

    function test_OnlyAuditorAddressCanRecord() public {
        uint256 agentId = identity.newAgent("sentinel.audit", sentinel);
        bytes32 subject = keccak256("x");
        vm.prank(other);
        vm.expectRevert(ValidationRegistry.NotAuditorAddress.selector);
        validation.recordAudit(agentId, subject, keccak256("r"), 10);
    }

    function test_RiskScoreOutOfRangeReverts() public {
        uint256 agentId = identity.newAgent("sentinel.audit", sentinel);
        vm.prank(sentinel);
        vm.expectRevert(ValidationRegistry.RiskScoreOutOfRange.selector);
        validation.recordAudit(agentId, keccak256("x"), keccak256("r"), 101);
    }

    function test_AuditorTrackRecord() public {
        uint256 agentId = identity.newAgent("sentinel.audit", sentinel);
        vm.startPrank(sentinel);
        validation.recordAudit(agentId, keccak256("a"), keccak256("ra"), 10);
        validation.recordAudit(agentId, keccak256("b"), keccak256("rb"), 90);
        vm.stopPrank();
        assertEq(validation.auditorRecordIds(agentId).length, 2);
    }
}
