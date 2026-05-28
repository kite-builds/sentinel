// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Vulnerable {
    address public owner = address(0x1234);
    uint256 public fee = 100;          // GAS-005: literal, not constant
    uint256[] public balances;
    mapping(address => uint256) public deposits;

    constructor() {
        owner = msg.sender;
    }

    // SEC-001 tx.origin, SEC-006 missing access control
    function setFee(uint256 newFee) public {
        require(tx.origin == owner, "not owner"); // GAS-001 string
        fee = newFee;
    }

    // SEC-007 reentrancy: external call before state update
    function withdraw(uint256 amount) public {
        require(deposits[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        ok;
        deposits[msg.sender] -= amount; // state write AFTER external call
    }

    // SEC-002 unchecked send
    function payout(address payable to, uint256 amount) public {
        to.send(amount);
    }

    // MNT-002 .transfer 2300 stipend
    function refund(address payable to) public {
        to.transfer(1 ether);
    }

    // SEC-005 weak randomness, MNT-001 block.number
    function luckyNumber() public view returns (uint256) {
        return uint256(block.timestamp) % block.number;
    }

    // GAS-002 length in loop, GAS-003 i++, GAS-004 memory ref param in public fn
    function sumAll(uint256[] memory xs) public {
        for (uint256 i = 0; i < xs.length; i++) {
            balances.push(xs[i]);
        }
    }

    // SEC-004 delegatecall, SEC-003 selfdestruct
    function exec(address target, bytes memory data) public {
        (bool s, ) = target.delegatecall(data);
        require(s, "fail");
        selfdestruct(payable(owner));
    }
}
