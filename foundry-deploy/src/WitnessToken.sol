// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title WitnessToken
 * @notice The WITNESS token - "Cryptographic proof that you were here"
 * @dev Simple ERC20 with fixed 1B supply, minted to treasury on deployment
 * 
 * Distribution (per WITNESS-PROTOCOL.md):
 * - 55% Agent Grants (550M) - For agent onboarding
 * - 20% Community (200M) - Airdrops, bounties, ecosystem
 * - 10% Reserve (100M) - Protocol buffer
 * - 10% Team (100M) - 2-year linear vesting
 * - 5% Liquidity (50M) - DEX bootstrap
 */
contract WitnessToken is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 Billion

    constructor(address treasury) ERC20("Witness", "WITNESS") {
        _mint(treasury, MAX_SUPPLY);
    }
}
