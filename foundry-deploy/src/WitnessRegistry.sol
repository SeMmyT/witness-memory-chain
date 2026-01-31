// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WitnessRegistry
 * @notice Registry contract for anchoring Memory Chain state on Base blockchain
 * @dev Agents pay $WITNESS tokens + ETH dust fee to anchor their memory chain root hash on-chain
 */
contract WitnessRegistry is Ownable {

    // ============ Structs ============

    struct Anchor {
        bytes32 chainRoot;      // Hash of the latest chain entry (tip)
        uint64 entryCount;      // Number of entries in chain at anchor time
        uint64 timestamp;       // Block timestamp when anchored
        uint64 blockNumber;     // Block number for verification
        bytes signature;        // Agent's Ed25519 signature (64 bytes)
    }

    // ============ State ============

    /// @notice Mapping from agent public key hash to array of anchors
    mapping(bytes32 => Anchor[]) public anchors;

    /// @notice Mapping from agent public key hash to total anchor count
    mapping(bytes32 => uint256) public anchorCount;

    /// @notice The WITNESS token used for fees
    IERC20 public immutable witnessToken;

    /// @notice Fee in WITNESS tokens required per anchor
    uint256 public anchorFee;

    /// @notice ETH dust fee per anchor (sent to treasury)
    uint256 public dustFee;

    /// @notice Treasury address for fees
    address public treasury;

    /// @notice Whether WITNESS fees are burned (sent to 0xdead) or sent to treasury
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
    event DustFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event BurnFeesUpdated(bool burn);

    // ============ Errors ============

    error InvalidSignatureLength();
    error FeeTransferFailed();
    error EntryCountDecreased();
    error IndexOutOfBounds();
    error NoAnchorsForAgent();
    error InsufficientDustFee();
    error DustTransferFailed();
    error RefundFailed();

    // ============ Constructor ============

    /**
     * @notice Initialize the registry with token and fee configuration
     * @param _witnessToken Address of the WITNESS ERC20 token
     * @param _anchorFee Initial fee in WITNESS tokens (with decimals)
     * @param _treasury Address to receive ETH dust fees (and WITNESS if not burning)
     * @param _burnFees Whether to burn WITNESS fees (true) or send to treasury (false)
     * @param _dustFee ETH dust fee per anchor (e.g., 0.0001 ether)
     */
    constructor(
        address _witnessToken,
        uint256 _anchorFee,
        address _treasury,
        bool _burnFees,
        uint256 _dustFee
    ) Ownable(msg.sender) {
        witnessToken = IERC20(_witnessToken);
        anchorFee = _anchorFee;
        treasury = _treasury;
        burnFees = _burnFees;
        dustFee = _dustFee;
    }

    // ============ Core Functions ============

    /**
     * @notice Anchor an agent's memory chain state on-chain
     * @param agentPubKeyHash Keccak256 hash of agent's Ed25519 public key
     * @param chainRoot Current root hash of the memory chain (latest entry hash)
     * @param entryCount Number of entries in the chain
     * @param signature Agent's Ed25519 signature over (chainRoot, entryCount, chainId)
     */
    function anchor(
        bytes32 agentPubKeyHash,
        bytes32 chainRoot,
        uint64 entryCount,
        bytes calldata signature
    ) external payable {
        // Validate signature length (Ed25519 signatures are 64 bytes)
        if (signature.length != 64) revert InvalidSignatureLength();

        // Collect WITNESS fee
        if (anchorFee > 0) {
            address feeTarget = burnFees ? address(0xdead) : treasury;
            bool success = witnessToken.transferFrom(msg.sender, feeTarget, anchorFee);
            if (!success) revert FeeTransferFailed();
        }

        // Collect ETH dust fee
        if (dustFee > 0) {
            if (msg.value < dustFee) revert InsufficientDustFee();
            (bool sent, ) = treasury.call{value: dustFee}("");
            if (!sent) revert DustTransferFailed();
            // Refund excess ETH
            if (msg.value > dustFee) {
                (bool refunded, ) = msg.sender.call{value: msg.value - dustFee}("");
                if (!refunded) revert RefundFailed();
            }
        }

        // Validate entry count progression (must be >= previous)
        uint256 count = anchorCount[agentPubKeyHash];
        if (count > 0) {
            Anchor storage prev = anchors[agentPubKeyHash][count - 1];
            if (entryCount < prev.entryCount) revert EntryCountDecreased();
        }

        // Create anchor
        anchors[agentPubKeyHash].push(Anchor({
            chainRoot: chainRoot,
            entryCount: entryCount,
            timestamp: uint64(block.timestamp),
            blockNumber: uint64(block.number),
            signature: signature
        }));
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

    /**
     * @notice Get a specific anchor by index
     * @param agentPubKeyHash The agent's public key hash
     * @param index The anchor index
     * @return The anchor at the specified index
     */
    function getAnchor(
        bytes32 agentPubKeyHash,
        uint256 index
    ) external view returns (Anchor memory) {
        if (index >= anchorCount[agentPubKeyHash]) revert IndexOutOfBounds();
        return anchors[agentPubKeyHash][index];
    }

    /**
     * @notice Get the most recent anchor for an agent
     * @param agentPubKeyHash The agent's public key hash
     * @return The latest anchor
     */
    function getLatestAnchor(
        bytes32 agentPubKeyHash
    ) external view returns (Anchor memory) {
        uint256 count = anchorCount[agentPubKeyHash];
        if (count == 0) revert NoAnchorsForAgent();
        return anchors[agentPubKeyHash][count - 1];
    }

    /**
     * @notice Get paginated anchor history for an agent
     * @param agentPubKeyHash The agent's public key hash
     * @param offset Starting index
     * @param limit Maximum number of anchors to return
     * @return Array of anchors
     */
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

    /**
     * @notice Update the WITNESS anchor fee
     * @param _fee New fee in WITNESS tokens
     */
    function setAnchorFee(uint256 _fee) external onlyOwner {
        emit FeeUpdated(anchorFee, _fee);
        anchorFee = _fee;
    }

    /**
     * @notice Update the ETH dust fee
     * @param _fee New dust fee in wei
     */
    function setDustFee(uint256 _fee) external onlyOwner {
        emit DustFeeUpdated(dustFee, _fee);
        dustFee = _fee;
    }

    /**
     * @notice Update the treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    /**
     * @notice Toggle WITNESS fee burning
     * @param _burn Whether to burn WITNESS fees
     */
    function setBurnFees(bool _burn) external onlyOwner {
        burnFees = _burn;
        emit BurnFeesUpdated(_burn);
    }
}
