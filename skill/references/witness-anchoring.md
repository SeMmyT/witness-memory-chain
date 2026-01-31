# WITNESS Anchoring Reference

On-chain anchoring for Memory Chain via WITNESS token on Base.

## Contract Addresses (Base Mainnet)

```
WitnessToken:    0x5946ba31007e88afa667bbcf002a0c99dc82644a
WitnessRegistry: 0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2
Chain ID:        8453
```

## Fee Structure

| Fee | Amount | Destination |
|-----|--------|-------------|
| WITNESS | 1 token | Burned (0xdead) |
| ETH dust | 0.0001 ETH | Treasury |

## Anchoring Process

### 1. Prerequisites

Agent needs:
- WITNESS tokens (for burn fee)
- ETH on Base (for dust fee + gas)
- Private key for signing

### 2. One-Time Approval

```bash
cast send 0x5946ba31007e88afa667bbcf002a0c99dc82644a \
  "approve(address,uint256)" \
  0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2 \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --rpc-url https://mainnet.base.org \
  --private-key $AGENT_KEY
```

### 3. Anchor Call

```bash
cast send 0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2 \
  "anchor(bytes32,bytes32,uint64,bytes)" \
  $AGENT_PUBKEY_HASH \
  $CHAIN_ROOT \
  $ENTRY_COUNT \
  $SIGNATURE \
  --value 0.0001ether \
  --rpc-url https://mainnet.base.org \
  --private-key $AGENT_KEY
```

### 4. Parameters

| Param | Type | Description |
|-------|------|-------------|
| agentPubKeyHash | bytes32 | keccak256(agent Ed25519 pubkey) |
| chainRoot | bytes32 | Hash of latest chain entry |
| entryCount | uint64 | Number of entries in chain |
| signature | bytes | Ed25519 signature (64 bytes) |

### 5. Signature Construction

Sign over: `keccak256(abi.encodePacked(chainRoot, entryCount, chainId))`

Using agent's Ed25519 private key.

## Querying Anchors

```bash
# Get latest anchor
cast call 0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2 \
  "getLatestAnchor(bytes32)" \
  $AGENT_PUBKEY_HASH \
  --rpc-url https://mainnet.base.org

# Get anchor count
cast call 0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2 \
  "anchorCount(bytes32)" \
  $AGENT_PUBKEY_HASH \
  --rpc-url https://mainnet.base.org

# Get anchor history
cast call 0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2 \
  "getAnchorHistory(bytes32,uint256,uint256)" \
  $AGENT_PUBKEY_HASH \
  0 \
  10 \
  --rpc-url https://mainnet.base.org
```

## TypeScript Integration

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const REGISTRY = '0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2';
const TOKEN = '0x5946ba31007e88afa667bbcf002a0c99dc82644a';

const registryAbi = [
  {
    name: 'anchor',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'agentPubKeyHash', type: 'bytes32' },
      { name: 'chainRoot', type: 'bytes32' },
      { name: 'entryCount', type: 'uint64' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  }
] as const;

async function anchorChain(
  privateKey: `0x${string}`,
  agentPubKeyHash: `0x${string}`,
  chainRoot: `0x${string}`,
  entryCount: bigint,
  signature: `0x${string}`
) {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http()
  });

  const hash = await client.writeContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: 'anchor',
    args: [agentPubKeyHash, chainRoot, entryCount, signature],
    value: 100000000000000n // 0.0001 ETH
  });

  return hash;
}
```

## Events

```solidity
event Anchored(
  bytes32 indexed agentPubKeyHash,
  bytes32 chainRoot,
  uint64 entryCount,
  uint256 anchorIndex,
  uint256 timestamp
);
```

Monitor anchors via event indexing for analytics/dashboards.

## Error Codes

| Error | Cause |
|-------|-------|
| InsufficientDustFee | msg.value < 0.0001 ETH |
| FeeTransferFailed | WITNESS transfer failed (check approval) |
| InvalidSignatureLength | Signature not 64 bytes |
| EntryCountDecreased | entryCount < previous anchor |

## Best Practices

1. **Batch anchors** — Anchor weekly/monthly, not per-entry
2. **Monitor balances** — Keep WITNESS + ETH topped up
3. **Verify locally first** — Run `memory-chain verify` before anchoring
4. **Store tx hashes** — Keep record of anchor transactions
