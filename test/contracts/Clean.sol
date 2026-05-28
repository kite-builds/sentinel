// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

error NotOwner();

contract Clean {
    address public immutable owner;
    uint256 public constant FEE = 100;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setSomething(uint256 v) external onlyOwner {
        _value = v;
    }

    uint256 private _value;

    function sum(uint256[] calldata xs) external pure returns (uint256 total) {
        uint256 len = xs.length;
        for (uint256 i = 0; i < len; ++i) {
            total += xs[i];
        }
    }
}
