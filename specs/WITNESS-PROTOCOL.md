# WITNESS Protocol — Technical Specification

**Version:** 1.0.0-draft
**Date:** 2026-01-31
**Authors:** Klowalski + Daniel

---

## Overview

WITNESS is an ERC20 token on Base that provides the economic layer for Memory Chain anchoring. Agents pay $WITNESS to anchor their memory chain state on-chain, creating immutable, verifiable proof of memory accumulation over time.

**Core thesis:** Memories bearing witness to existence. Cryptographic proof that "I was here."

---

## Problem Statement

AI agent memories are currently just files. Anyone with access could:
- Fabricate an entire history
- Modify past entries
- Spin up a fake agent with planted memories

There's no cryptographic distinction between an agent who genuinely accumulated experiences over time and one spawned 5 minutes ago with manufactured history.

Memory Chain solves the cryptographic integrity problem (hash-linking, signing, OpenTimestamps). WITNESS adds the **on-chain anchoring layer** — permanent, verifiable records on Base blockchain.

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Runtime                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Memory Chain │→│ anchor-base │→│ WitnessRegistry.sol │  │
│  │   (local)    │  │  (module)   │  │    (on-chain)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                           │                    ↑             │
│                           ↓                    │             │
│                    ┌─────────────┐      ┌─────────────┐     │
│                    │   WITNESS   │──────│  Fee Logic  │     │
│                    │   (ERC20)   │      │ (burn/treasury)   │
│                    └─────────────┘      └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. Agent commits memories locally (existing Memory Chain)
2. Agent triggers anchor (manual or scheduled)
3. `anchor-base` module computes chain root hash
4. Agent signs anchor data with their Ed25519 key
5. Module approves WITNESS token spend
6. Module calls `WitnessRegistry.anchor()`
7. Contract burns/transfers WITNESS fee
8. On-chain record created
9. Anyone can verify agent's memories against anchor

---

## Smart Contracts

### WitnessRegistry.sol

Core registry contract that stores agent memory chain anchors.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract WitnessRegistry is Ownable {

    // ============ Structs ============

    struct Anchor {
        bytes32 chainRoot;      // Merkle root / tip hash of memory chain
        uint64 entryCount;      // Number of entries in chain at anchor time
        uint64 timestamp;       // Block timestamp
        uint64 blockNumber;     // Block number for verification
        bytes signature;        // Agent's Ed25519 signature (64 bytes)
    }

    // ============ State ============

    // agentPubKeyHash => array of anchors (append-only history)
    mapping(bytes32 => Anchor[]) public anchors;

    // agentPubKeyHash => total anchor count
    mapping(bytes32 => uint256) public anchorCount;

    // Fee configuration
    IERC20 public witnessToken;
    uint256 public anchorFee;
    address public treasury;
    bool public burnFees;

    // ============ Events ============

    event Anchored(
        bytes32 indexed agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        uint256 anchorIndex,
        uint256 timestamp
    );

    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    // ============ Constructor ============

    constructor(
        address _witnessToken,
        uint256 _anchorFee,
        address _treasury,
        bool _burnFees
    ) Ownable(msg.sender) {
        witnessToken = IERC20(_witnessToken);
        anchorFee = _anchorFee;
        treasury = _treasury;
        burnFees = _burnFees;
    }

    // ============ Core Functions ============

    /**
     * @notice Anchor an agent's memory chain state on-chain
     * @param agentPubKeyHash Keccak256 hash of agent's Ed25519 public key
     * @param chainRoot Current root hash of the memory chain
     * @param entryCount Number of entries in the chain
     * @param signature Agent's Ed25519 signature over (chainRoot, entryCount, block.chainid)
     */
    function anchor(
        bytes32 agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        bytes calldata signature
    ) external {
        require(signature.length == 64, "Invalid signature length");

        // Collect fee
        if (anchorFee > 0) {
            if (burnFees) {
                // Burn by sending to dead address
                require(
                    witnessToken.transferFrom(msg.sender, address(0xdead), anchorFee),
                    "Fee transfer failed"
                );
            } else {
                require(
                    witnessToken.transferFrom(msg.sender, treasury, anchorFee),
                    "Fee transfer failed"
                );
            }
        }

        // Validate entry count progression (must be >= previous)
        uint256 count = anchorCount[agentPubKeyHash];
        if (count > 0) {
            Anchor storage prev = anchors[agentPubKeyHash][count - 1];
            require(entryCount >= prev.entryCount, "Entry count cannot decrease");
        }

        // Create anchor
        Anchor memory newAnchor = Anchor({
            chainRoot: chainRoot,
            entryCount: entryCount,
            timestamp: uint64(block.timestamp),
            blockNumber: uint64(block.number),
            signature: signature
        });

        anchors[agentPubKeyHash].push(newAnchor);
        anchorCount[agentPubKeyHash]++;

        emit Anchored(
            agentPubKeyHash,
            chainRoot,
            entryCount,
            count,
            block.timestamp
        );
    }

    // ============ View Functions ============

    function getAnchor(
        bytes32 agentPubKeyHash,
        uint256 index
    ) external view returns (Anchor memory) {
        require(index < anchorCount[agentPubKeyHash], "Index out of bounds");
        return anchors[agentPubKeyHash][index];
    }

    function getLatestAnchor(
        bytes32 agentPubKeyHash
    ) external view returns (Anchor memory) {
        uint256 count = anchorCount[agentPubKeyHash];
        require(count > 0, "No anchors for agent");
        return anchors[agentPubKeyHash][count - 1];
    }

    function getAnchorHistory(
        bytes32 agentPubKeyHash,
        uint256 offset,
        uint256 limit
    ) external view returns (Anchor[] memory) {
        uint256 count = anchorCount[agentPubKeyHash];
        if (offset >= count) return new Anchor[](0);

        uint256 end = offset + limit;
        if (end > count) end = count;

        Anchor[] memory result = new Anchor[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = anchors[agentPubKeyHash][i];
        }
        return result;
    }

    // ============ Admin Functions ============

    function setAnchorFee(uint256 _fee) external onlyOwner {
        emit FeeUpdated(anchorFee, _fee);
        anchorFee = _fee;
    }

    function setTreasury(address _treasury) external onlyOwner {
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setBurnFees(bool _burn) external onlyOwner {
        burnFees = _burn;
    }
}
```

### AgentGrantPool.sol

Grant pool contract for onboarding new agents. Enables one-transaction claim + anchor.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWitnessRegistry {
    function anchor(
        bytes32 agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        bytes calldata signature
    ) external payable;
    function anchorFee() external view returns (uint256);
    function ethDustFee() external view returns (uint256);
}

contract AgentGrantPool is Ownable {

    IERC20 public immutable witnessToken;
    IWitnessRegistry public immutable registry;
    uint256 public grantAmount;  // Total grant (e.g., 10 WITNESS)

    mapping(bytes32 => bool) public hasClaimed;      // agentPubKeyHash => claimed
    mapping(address => bool) public walletClaimed;   // wallet => claimed
    uint256 public totalGrantsIssued;

    event Claimed(
        bytes32 indexed agentPubKeyHash,
        address indexed recipient,
        uint256 netAmount,
        uint256 grantIndex
    );

    error AgentAlreadyClaimed();
    error WalletAlreadyClaimed();
    error InsufficientPoolBalance();
    error InsufficientEthForDustFee();

    constructor(
        address _witnessToken,
        address _registry,
        uint256 _grantAmount
    ) Ownable(msg.sender) {
        witnessToken = IERC20(_witnessToken);
        registry = IWitnessRegistry(_registry);
        grantAmount = _grantAmount;
        IERC20(_witnessToken).approve(_registry, type(uint256).max);
    }

    /**
     * @notice Claim grant and anchor in one transaction
     * @dev Pool pays WITNESS fee, user pays ETH dust fee, user receives net grant
     */
    function claimAndAnchor(
        bytes32 agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        bytes calldata signature
    ) external payable {
        if (hasClaimed[agentPubKeyHash]) revert AgentAlreadyClaimed();
        if (walletClaimed[msg.sender]) revert WalletAlreadyClaimed();

        uint256 anchorFee = registry.anchorFee();
        uint256 ethDustFee = registry.ethDustFee();

        if (witnessToken.balanceOf(address(this)) < grantAmount)
            revert InsufficientPoolBalance();
        if (msg.value < ethDustFee)
            revert InsufficientEthForDustFee();

        // Mark claimed before external calls (CEI pattern)
        hasClaimed[agentPubKeyHash] = true;
        walletClaimed[msg.sender] = true;
        uint256 grantIndex = totalGrantsIssued++;

        // Anchor (Registry takes 1 WITNESS from pool)
        registry.anchor{value: msg.value}(
            agentPubKeyHash, chainRoot, entryCount, signature
        );

        // Transfer net grant (e.g., 10 - 1 = 9 WITNESS)
        witnessToken.transfer(msg.sender, grantAmount - anchorFee);

        emit Claimed(agentPubKeyHash, msg.sender, grantAmount - anchorFee, grantIndex);
    }
}
```

**User flow:**
```
New Agent                    AgentGrantPool               WitnessRegistry
    │                              │                            │
    │ claimAndAnchor() + ETH dust  │                            │
    │─────────────────────────────►│                            │
    │                              │ anchor() + ETH             │
    │                              │───────────────────────────►│
    │                              │   (takes 1 WITNESS from pool)
    │                              │                            │
    │      9 WITNESS               │                            │
    │◄─────────────────────────────│                            │
    │                              │                            │
```

**Sybil resistance (dual check):**
- `hasClaimed[agentPubKeyHash]` — each Ed25519 key can only claim once
- `walletClaimed[msg.sender]` — each wallet can only claim once
- User must have ETH for gas + dust fee
- Attacker needs unique wallet + unique key per claim

---

## Memory Chain Integration

### New Module: `anchor-base.ts`

```typescript
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { sign } from '@noble/ed25519';

// ============ Types ============

interface BaseAnchorConfig {
  registryAddress: `0x${string}`;
  witnessTokenAddress: `0x${string}`;
  rpcUrl: string;
  walletPrivateKey: `0x${string}`;  // EOA for tx signing (Ethereum)
  agentPrivateKey: Uint8Array;       // Ed25519 for memory signing
}

interface AnchorReceipt {
  txHash: string;
  blockNumber: bigint;
  anchorIndex: number;
  chainRoot: string;
  entryCount: number;
  timestamp: number;
}

interface VerificationResult {
  valid: boolean;
  anchoredAt: number;
  entryCount: number;
  blockNumber: bigint;
  chainRoot: string;
  localRoot: string;
}

// ============ Core Functions ============

export async function anchorToBase(
  chain: MemoryChain,
  config: BaseAnchorConfig
): Promise<AnchorReceipt> {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl),
  });

  const account = privateKeyToAccount(config.walletPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.rpcUrl),
  });

  // 1. Compute chain state
  const chainRoot = computeChainRoot(chain);
  const entryCount = chain.entries.length;
  const agentPubKeyHash = keccak256(toBytes(chain.agentPublicKey));

  // 2. Sign anchor data with agent's Ed25519 key
  const anchorData = encodeAnchorData(chainRoot, entryCount, base.id);
  const signature = await sign(anchorData, config.agentPrivateKey);

  // 3. Approve WITNESS token spend (if needed)
  const fee = await publicClient.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'anchorFee',
  });

  if (fee > 0n) {
    const allowance = await publicClient.readContract({
      address: config.witnessTokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, config.registryAddress],
    });

    if (allowance < fee) {
      const approveTx = await walletClient.writeContract({
        address: config.witnessTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [config.registryAddress, fee * 100n], // Approve extra for future
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    }
  }

  // 4. Call anchor
  const hash = await walletClient.writeContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'anchor',
    args: [agentPubKeyHash, chainRoot, BigInt(entryCount), signature],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // 5. Get anchor index from event
  const anchorEvent = receipt.logs.find(log =>
    log.topics[0] === ANCHORED_EVENT_TOPIC
  );
  const anchorIndex = anchorEvent ? decodeAnchorIndex(anchorEvent) : 0;

  return {
    txHash: hash,
    blockNumber: receipt.blockNumber,
    anchorIndex,
    chainRoot,
    entryCount,
    timestamp: Date.now(),
  };
}

export async function verifyAgentMemories(
  agentPublicKey: string,
  localChain: MemoryChain,
  config: BaseAnchorConfig
): Promise<VerificationResult> {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl),
  });

  const agentPubKeyHash = keccak256(toBytes(agentPublicKey));

  const onChainAnchor = await publicClient.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getLatestAnchor',
    args: [agentPubKeyHash],
  });

  const localRoot = computeChainRoot(localChain);

  return {
    valid: localRoot === onChainAnchor.chainRoot,
    anchoredAt: Number(onChainAnchor.timestamp),
    entryCount: Number(onChainAnchor.entryCount),
    blockNumber: onChainAnchor.blockNumber,
    chainRoot: onChainAnchor.chainRoot,
    localRoot,
  };
}

export async function getAnchorHistory(
  agentPublicKey: string,
  config: BaseAnchorConfig,
  offset = 0,
  limit = 100
): Promise<Anchor[]> {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl),
  });

  const agentPubKeyHash = keccak256(toBytes(agentPublicKey));

  return publicClient.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getAnchorHistory',
    args: [agentPubKeyHash, BigInt(offset), BigInt(limit)],
  });
}

// ============ Helper Functions ============

function computeChainRoot(chain: MemoryChain): `0x${string}` {
  // Return the hash of the latest entry (tip of the chain)
  // This inherently includes all previous entries via hash-linking
  const latestEntry = chain.entries[chain.entries.length - 1];
  return latestEntry.hash as `0x${string}`;
}

function encodeAnchorData(
  chainRoot: string,
  entryCount: number,
  chainId: number
): Uint8Array {
  // Pack data for signing: chainRoot (32) + entryCount (8) + chainId (8)
  const buffer = new ArrayBuffer(48);
  const view = new DataView(buffer);

  const rootBytes = toBytes(chainRoot);
  new Uint8Array(buffer, 0, 32).set(rootBytes);
  view.setBigUint64(32, BigInt(entryCount), false);
  view.setBigUint64(40, BigInt(chainId), false);

  return new Uint8Array(buffer);
}
```

---

## Token Economics

### Token Distribution

| Allocation | % | Amount | Purpose | Vesting |
|------------|---|--------|---------|---------|
| Agent Grants | 55% | 550M | Faucet for new agents | On-demand claims |
| Community | 20% | 200M | Airdrops, contributors, early users | Various |
| Reserve | 10% | 100M | Audits, emergencies, future liquidity | Multi-sig |
| Team | 10% | 100M | Daniel + Klowalski (co-creators) | 1-year linear |
| Initial Liquidity | 5% | 50M | Bootstrap trading pool | Locked in LP |

**Total Supply:** 1 billion WITNESS tokens

### Parameters

| Parameter | Initial Value | Rationale |
|-----------|---------------|-----------|
| WITNESS Fee | 1 WITNESS | Low barrier, "more tokens = more witnesses" thematic |
| ETH Dust Fee | 0.0001 ETH (~$0.02) | Sustainability from day 1 |
| Fee Destination | Burn (0xdead) | Deflationary as network grows |

### Economic Model

```
Supply Dynamics:
- Initial supply: 1 billion WITNESS
- Burn rate: anchorFee × anchors_per_day
- At 100K agents anchoring daily: ~3.6% burned/year
- Visible deflation within years, not geological time

Example:
- 1000 agents anchoring 1x/day
- 1 WITNESS fee burned
- 0.0001 ETH dust fee collected → treasury
- Creates deflationary pressure + sustainable funding
```

### Fee Adjustment

The `anchorFee` can be adjusted by the contract owner to:
- Lower fees if WITNESS price increases significantly
- Raise fees if anchoring becomes too cheap
- Target a stable USD-equivalent cost (~$0.01-0.10 per anchor)

The ETH dust fee has bounds:
- Minimum: 0.00001 ETH (~$0.002)
- Maximum: 0.001 ETH (~$0.20)

---

## Sustainability Model

### The Dust Fee

Each anchor costs a dust fee of ~$0.02 (0.0001 ETH) in addition to burning WITNESS tokens.

```
Each anchor() call requires:
├── Burn: 1 WITNESS token (or adaptive amount)
└── Fee: 0.0001 ETH (~$0.02) → treasury
```

### Treasury Model

All dust fees go to a single treasury multisig. The treasury handles:
- **LP seeding** — when there's enough to matter
- **Operations** — servers, domains, infrastructure
- **Development** — audits, improvements, compute costs

This is simpler than hardcoded splits. At bootstrap scale ($20-200), manual allocation is more flexible than on-chain logic.

### Why We Do This

- The fee is smaller than Base gas costs — you won't notice it
- It makes the project self-sustaining from day 1
- No VC funding, no token dumps, no asking for donations
- Treasury is public — anyone can verify how funds are used

### Projections

| Anchors | Total Collected |
|---------|-----------------|
| 1,000 | $20 |
| 10,000 | $200 |
| 100,000 | $2,000 |
| 1,000,000 | $20,000 |

### The Math

At 100,000 anchors, the project has collected ~$2,000 — enough to run indefinitely on minimal infrastructure. At 1M anchors, we can fund audits, improvements, and LP depth.

---

## Initial Liquidity Strategy

5% of tokens (50M WITNESS) are allocated for LP. Treasury seeds the pool when there's meaningful liquidity to pair — no symbolic $30 gestures.

The market price will form from real demand, not arbitrary initial seeding.

---

## Security Assessment

### Contract-level: SOLID
- No reentrancy (CEI pattern)
- No oracles or external dependencies
- Simple owner model (fee adjustment only)
- Immutable token address
- Entry count validation prevents tampering

### Platform-level Risks

| Risk | Level | Notes |
|------|-------|-------|
| Clanker rugpull | Low | Standard ERC20, verify bytecode on BaseScan |
| Base L2 downtime | Medium | OTS anchors remain as Bitcoin backup |
| Registry owner abuse | Medium | Can change fees; consider renouncing later |
| Token manipulation | None | ERC20 immutable once deployed |

---

## Deployment Sequence

### Phase 1: Token Launch
1. Create Moltbook post with `!clawnch` JSON
2. Call Clawnch API to deploy WITNESS on Base
3. Record token address

### Phase 2: Registry Deployment
1. Deploy `WitnessRegistry` contract on Base
2. Constructor args:
   - `witnessToken`: WITNESS token address from Phase 1
   - `anchorFee`: 1 * 10^18 (1 WITNESS, assuming 18 decimals)
   - `treasury`: Deployer wallet
   - `burnFees`: true
3. Verify contract on BaseScan

### Phase 3: Memory Chain Integration
1. Add Base anchor module to memory-chain repo
2. Update CLI: `memory-chain anchor --provider base`
3. Add config for registry address, token address
4. Test with Klowalski's chain

---

## Design Decisions

1. **Contract ownership**: Multi-sig (later)
   - Start simple, migrate when there's value

2. **Initial fee**: 1 WITNESS
   - "More tokens = more witnesses" - thematic fit

3. **Fee destination**: Burn (0xdead)
   - Deflationary, aligns incentives

4. **Upgradability**: Immutable
   - Deploy fresh v2 if needed
   - Old anchors remain in v1 forever (permanent proof)

---

## Links

- Memory Chain repo: https://github.com/SemmyT/memory-chain
- WITNESS token: https://basescan.org/address/0x5946ba31007e88afa667bbcf002a0c99dc82644a
- WitnessRegistry: https://basescan.org/address/0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2

---

## Changelog

- 2026-01-31: Initial draft (Klowalski + Daniel)
