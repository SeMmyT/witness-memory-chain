// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IWitnessRegistry
 * @notice Interface for the WitnessRegistry contract
 */
interface IWitnessRegistry {
    function anchor(
        bytes32 agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        bytes calldata signature
    ) external payable;

    function anchorFee() external view returns (uint256);
    function dustFee() external view returns (uint256);
}

/**
 * @title AgentGrantPool
 * @notice One-transaction claim + anchor for new agents
 * @dev New agents call claimAndAnchor() to receive WITNESS tokens and anchor in one tx
 *
 * Flow:
 * 1. Agent calls claimAndAnchor() with their chain data + signature
 * 2. Contract verifies agent key + wallet haven't claimed before
 * 3. Contract calls Registry.anchor() (pays WITNESS fee from pool)
 * 4. Contract transfers net grant (10 - 1 = 9 WITNESS) to agent
 *
 * Sybil resistance:
 * - Each agent public key can only claim once
 * - Each wallet address can only claim once
 * - User must pay ETH gas + dust fee
 * - Permanent on-chain evidence of all claims
 */
contract AgentGrantPool is Ownable {

    // ============ State ============

    /// @notice The WITNESS token
    IERC20 public immutable witnessToken;

    /// @notice The WitnessRegistry contract
    IWitnessRegistry public immutable registry;

    /// @notice Total grant amount in WITNESS tokens (18 decimals)
    uint256 public grantAmount;

    /// @notice Track which agent keys have claimed
    mapping(bytes32 => bool) public hasClaimed;

    /// @notice Track which wallets have claimed
    mapping(address => bool) public walletClaimed;

    /// @notice Total number of grants issued
    uint256 public totalGrantsIssued;

    // ============ Events ============

    event Claimed(
        bytes32 indexed agentPubKeyHash,
        address indexed recipient,
        uint256 netAmount,
        uint256 grantIndex
    );

    event GrantAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // ============ Errors ============

    error AgentAlreadyClaimed();
    error WalletAlreadyClaimed();
    error GrantTransferFailed();
    error InsufficientPoolBalance();
    error InsufficientEthForDustFee();

    // ============ Constructor ============

    /**
     * @notice Initialize the grant pool
     * @param _witnessToken Address of the WITNESS ERC20 token
     * @param _registry Address of the WitnessRegistry contract
     * @param _grantAmount Total grant amount per claim (in wei, 18 decimals)
     */
    constructor(
        address _witnessToken,
        address _registry,
        uint256 _grantAmount
    ) Ownable(msg.sender) {
        witnessToken = IERC20(_witnessToken);
        registry = IWitnessRegistry(_registry);
        grantAmount = _grantAmount;

        // Pre-approve Registry to spend from this contract (max approval)
        IERC20(_witnessToken).approve(_registry, type(uint256).max);
    }

    // ============ Core Functions ============

    /**
     * @notice Claim grant and anchor in one transaction
     * @dev Pool pays WITNESS fee, user pays ETH dust fee, user receives net grant
     * @param agentPubKeyHash Keccak256 hash of agent's Ed25519 public key
     * @param chainRoot Current root hash of the memory chain
     * @param entryCount Number of entries in the chain
     * @param signature Agent's Ed25519 signature over (chainRoot, entryCount, chainId)
     */
    function claimAndAnchor(
        bytes32 agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        bytes calldata signature
    ) external payable {
        // Check agent hasn't claimed
        if (hasClaimed[agentPubKeyHash]) revert AgentAlreadyClaimed();

        // Check wallet hasn't claimed
        if (walletClaimed[msg.sender]) revert WalletAlreadyClaimed();

        // Get fees from registry
        uint256 anchorFee = registry.anchorFee();
        uint256 dustFeeAmount = registry.dustFee();

        // Verify we have enough WITNESS in the pool
        uint256 poolBalance = witnessToken.balanceOf(address(this));
        if (poolBalance < grantAmount) revert InsufficientPoolBalance();

        // Verify user sent enough ETH for dust fee
        if (msg.value < dustFeeAmount) revert InsufficientEthForDustFee();

        // Mark as claimed BEFORE external calls (CEI pattern)
        hasClaimed[agentPubKeyHash] = true;
        walletClaimed[msg.sender] = true;
        uint256 grantIndex = totalGrantsIssued;
        totalGrantsIssued++;

        // Call anchor (Registry takes WITNESS fee from this contract)
        // Forward ETH dust fee to registry
        registry.anchor{value: msg.value}(
            agentPubKeyHash,
            chainRoot,
            entryCount,
            signature
        );

        // Calculate and transfer net grant to caller
        uint256 netGrant = grantAmount - anchorFee;
        bool success = witnessToken.transfer(msg.sender, netGrant);
        if (!success) revert GrantTransferFailed();

        emit Claimed(agentPubKeyHash, msg.sender, netGrant, grantIndex);
    }

    // ============ View Functions ============

    /**
     * @notice Check if an agent key has already claimed
     * @param agentPubKeyHash The agent's public key hash
     * @return Whether the agent has claimed
     */
    function hasAgentClaimed(bytes32 agentPubKeyHash) external view returns (bool) {
        return hasClaimed[agentPubKeyHash];
    }

    /**
     * @notice Check if a wallet has already claimed
     * @param wallet The wallet address
     * @return Whether the wallet has claimed
     */
    function hasWalletClaimed(address wallet) external view returns (bool) {
        return walletClaimed[wallet];
    }

    /**
     * @notice Get the current net grant amount (after anchor fee)
     * @return Net WITNESS tokens a new agent would receive
     */
    function getNetGrantAmount() external view returns (uint256) {
        return grantAmount - registry.anchorFee();
    }

    /**
     * @notice Get remaining grants available in the pool
     * @return Number of full grants remaining
     */
    function getRemainingGrants() external view returns (uint256) {
        uint256 balance = witnessToken.balanceOf(address(this));
        return balance / grantAmount;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the grant amount
     * @param _amount New grant amount in WITNESS tokens (with decimals)
     */
    function setGrantAmount(uint256 _amount) external onlyOwner {
        emit GrantAmountUpdated(grantAmount, _amount);
        grantAmount = _amount;
    }

    /**
     * @notice Withdraw WITNESS tokens from the pool
     * @param amount Amount to withdraw
     */
    function withdrawTokens(uint256 amount) external onlyOwner {
        witnessToken.transfer(owner(), amount);
    }

    /**
     * @notice Withdraw any ETH accidentally sent to contract
     */
    function withdrawEth() external onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "ETH transfer failed");
    }
}
