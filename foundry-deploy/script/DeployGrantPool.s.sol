// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {AgentGrantPool} from "../src/AgentGrantPool.sol";

contract DeployGrantPool is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        address token = 0x5946BA31007e88AFa667Bbcf002A0C99Dc82644A;
        address registry = 0x2f4DceC8E7e630C399F9F947C65c4626D8Ad73b2;
        uint256 grantAmount = 10 * 10**18; // 10 WITNESS

        console.log("Deploying AgentGrantPool...");
        console.log("Token:", token);
        console.log("Registry:", registry);
        console.log("Grant amount:", grantAmount);

        vm.startBroadcast(deployerPrivateKey);

        AgentGrantPool pool = new AgentGrantPool(token, registry, grantAmount);
        
        console.log("AgentGrantPool deployed at:", address(pool));

        vm.stopBroadcast();
    }
}
