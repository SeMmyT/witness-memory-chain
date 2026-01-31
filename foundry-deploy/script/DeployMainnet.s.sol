// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {WitnessToken} from "../src/WitnessToken.sol";
import {WitnessRegistry} from "../src/WitnessRegistry.sol";

/**
 * @title DeployMainnet
 * @notice Deploy WITNESS token and registry to Base mainnet
 * 
 * Usage:
 *   forge script script/DeployMainnet.s.sol:DeployMainnet \
 *     --rpc-url https://mainnet.base.org \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $BASESCAN_API_KEY
 */
contract DeployMainnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Deployer (Klow) receives all 1B tokens for distribution per spec
        // Treasury (Daniel) receives ETH dust fees for operational costs
        address treasury = 0xFe2Be4310F49C070314D68F9Fd431324e0b14F33;

        console.log("=== WITNESS Mainnet Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy WITNESS Token (1B supply to treasury)
        WitnessToken token = new WitnessToken(treasury);
        console.log("WitnessToken deployed at:", address(token));

        // 2. Deploy WitnessRegistry
        // Fees per WITNESS-PROTOCOL.md:
        // - 1 WITNESS per anchor (burned to 0xdead)
        // - 0.0001 ETH dust fee (to treasury)
        WitnessRegistry registry = new WitnessRegistry(
            address(token),
            1 * 10**18,       // 1 WITNESS fee
            treasury,         // Treasury for dust fees
            true,             // Burn WITNESS fees to 0xdead
            0.0001 ether      // 0.0001 ETH dust fee (~$0.02)
        );
        console.log("WitnessRegistry deployed at:", address(registry));

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("Chain: Base Mainnet (8453)");
        console.log("WitnessToken:", address(token));
        console.log("WitnessRegistry:", address(registry));
        console.log("Total Supply: 1,000,000,000 WITNESS");
        console.log("Anchor Fee: 1 WITNESS (burned)");
        console.log("Dust Fee: 0.0001 ETH (to treasury)");
        console.log("\n=== Next Steps ===");
        console.log("1. Verify contracts on BaseScan");
        console.log("2. Distribute tokens per spec:");
        console.log("   - 55% (550M) Agent Grants");
        console.log("   - 20% (200M) Community");
        console.log("   - 10% (100M) Reserve");
        console.log("   - 10% (100M) Team (vesting)");
        console.log("   - 5% (50M) Liquidity");
        console.log("3. Create Uniswap V3 pool");
    }
}
