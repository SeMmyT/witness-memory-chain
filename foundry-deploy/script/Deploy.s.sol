// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {WitnessRegistry} from "../src/WitnessRegistry.sol";

// Simple mock ERC20 for testnet
contract MockWitness {
    string public name = "WITNESS";
    string public symbol = "WITNESS";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 initialSupply) {
        totalSupply = initialSupply;
        balanceOf[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying from:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock WITNESS token with 1 billion supply
        MockWitness witness = new MockWitness(1_000_000_000 * 10**18);
        console.log("MockWitness deployed at:", address(witness));

        // Deploy WitnessRegistry
        // Fee: 1 WITNESS per anchor (1e18 wei)
        // Treasury: deployer
        // Burn fees: true (for testnet, we'll burn to 0xdead)
        WitnessRegistry registry = new WitnessRegistry(
            address(witness),
            1 * 10**18,  // 1 WITNESS fee
            deployer,
            true,        // burn fees
            0.0001 ether // dust fee
        );
        console.log("WitnessRegistry deployed at:", address(registry));

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("Network: Base Sepolia");
        console.log("MockWitness:", address(witness));
        console.log("WitnessRegistry:", address(registry));
        console.log("Anchor fee: 1 WITNESS");
        console.log("Fee mode: BURN");
    }
}
