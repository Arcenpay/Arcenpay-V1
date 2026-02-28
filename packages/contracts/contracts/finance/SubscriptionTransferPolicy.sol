// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SubscriptionTransferPolicy
/// @notice Controls subscription NFT transfer rules for secondary-market trading
/// @dev Enforced by SubscriptionRegistry._update() hook. Supports:
///   - Provider-level transfer toggle (allow/deny all transfers)
///   - Per-plan transfer rules (cooldown periods, max transfers, royalty fees)
///   - Blocklist/allowlist for specific addresses
contract SubscriptionTransferPolicy is Ownable {

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct PlanTransferRule {
        bool transfersEnabled;      // Whether transfers are allowed for this plan
        uint64 cooldownPeriod;      // Minimum seconds between transfers
        uint256 maxTransfers;       // Maximum number of transfers (0 = unlimited)
        uint256 royaltyBps;         // Royalty fee in basis points (100 = 1%)
        address royaltyReceiver;    // Address that receives royalty fees
        bool requiresApproval;      // Whether provider must approve transfers
    }

    struct TokenTransferState {
        uint256 transferCount;      // Number of times this token has been transferred
        uint64 lastTransferAt;      // Timestamp of last transfer
        address originalMinter;     // Original subscriber who minted
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event GlobalTransferToggled(bool enabled);
    event PlanTransferRuleSet(uint256 indexed planId);
    event TransferApproved(uint256 indexed tokenId, address indexed from, address indexed to);
    event TransferBlocked(uint256 indexed tokenId, string reason);
    event AddressBlocklisted(address indexed account, bool blocked);
    event RoyaltyCollected(uint256 indexed tokenId, uint256 amount, address receiver);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Global transfer toggle
    bool public globalTransfersEnabled;

    /// @notice Plan ID => transfer rules
    mapping(uint256 => PlanTransferRule) public planRules;

    /// @notice Token ID => transfer state
    mapping(uint256 => TokenTransferState) public tokenStates;

    /// @notice Blocklisted addresses (cannot send or receive)
    mapping(address => bool) public blocklist;

    /// @notice Pending transfer approvals: tokenId => approved recipient
    mapping(uint256 => address) public pendingApprovals;

    /// @notice The SubscriptionRegistry contract authorized to call policy checks
    address public registry;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "TransferPolicy: zero registry");
        registry = _registry;
        globalTransfersEnabled = true;
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Toggle global transfer permissions
    function setGlobalTransfers(bool enabled) external onlyOwner {
        globalTransfersEnabled = enabled;
        emit GlobalTransferToggled(enabled);
    }

    /// @notice Configure transfer rules for a plan
    function setPlanTransferRule(
        uint256 planId,
        bool transfersEnabled,
        uint64 cooldownPeriod,
        uint256 maxTransfers,
        uint256 royaltyBps,
        address royaltyReceiver,
        bool requiresApproval
    ) external onlyOwner {
        require(royaltyBps <= 10000, "TransferPolicy: royalty > 100%");

        planRules[planId] = PlanTransferRule({
            transfersEnabled: transfersEnabled,
            cooldownPeriod: cooldownPeriod,
            maxTransfers: maxTransfers,
            royaltyBps: royaltyBps,
            royaltyReceiver: royaltyReceiver != address(0) ? royaltyReceiver : owner(),
            requiresApproval: requiresApproval
        });

        emit PlanTransferRuleSet(planId);
    }

    /// @notice Blocklist or unblocklist an address
    function setBlocklist(address account, bool blocked) external onlyOwner {
        blocklist[account] = blocked;
        emit AddressBlocklisted(account, blocked);
    }

    /// @notice Approve a pending transfer
    function approveTransfer(uint256 tokenId, address to) external onlyOwner {
        pendingApprovals[tokenId] = to;
        emit TransferApproved(tokenId, address(0), to);
    }

    // ============================================================
    //                    POLICY CHECK (CORE)
    // ============================================================

    /// @notice Check if a transfer is allowed. Called by SubscriptionRegistry._update()
    /// @param tokenId The subscription NFT token ID
    /// @param planId The plan ID for the subscription
    /// @param from The sender address
    /// @param to The recipient address
    /// @return allowed Whether the transfer is permitted
    /// @return reason If not allowed, the reason string
    function checkTransfer(
        uint256 tokenId,
        uint256 planId,
        address from,
        address to
    ) external view returns (bool allowed, string memory reason) {
        // Mints (from == 0) and burns (to == 0) are always allowed
        if (from == address(0) || to == address(0)) {
            return (true, "");
        }

        // Global toggle
        if (!globalTransfersEnabled) {
            return (false, "Transfers globally disabled");
        }

        // Blocklist check
        if (blocklist[from]) return (false, "Sender is blocklisted");
        if (blocklist[to]) return (false, "Recipient is blocklisted");

        PlanTransferRule storage rule = planRules[planId];

        // Plan-level toggle (if rule exists)
        if (!rule.transfersEnabled && rule.cooldownPeriod == 0 && rule.maxTransfers == 0) {
            // No rule configured — allow by default
            return (true, "");
        }

        if (!rule.transfersEnabled) {
            return (false, "Transfers disabled for this plan");
        }

        // Cooldown check
        TokenTransferState storage state = tokenStates[tokenId];
        if (rule.cooldownPeriod > 0 && state.lastTransferAt > 0) {
            if (block.timestamp < state.lastTransferAt + rule.cooldownPeriod) {
                return (false, "Transfer cooldown not elapsed");
            }
        }

        // Max transfers check
        if (rule.maxTransfers > 0 && state.transferCount >= rule.maxTransfers) {
            return (false, "Maximum transfers reached");
        }

        // Approval check
        if (rule.requiresApproval) {
            if (pendingApprovals[tokenId] != to) {
                return (false, "Transfer not approved by provider");
            }
        }

        return (true, "");
    }

    /// @notice Record a transfer (called after successful transfer)
    function recordTransfer(
        uint256 tokenId,
        address from,
        address to
    ) external {
        require(msg.sender == registry, "TransferPolicy: unauthorized");

        if (from == address(0)) {
            // Mint — record original minter
            tokenStates[tokenId].originalMinter = to;
        } else if (to != address(0)) {
            // Transfer — update state
            tokenStates[tokenId].transferCount++;
            tokenStates[tokenId].lastTransferAt = uint64(block.timestamp);
            // Clear pending approval
            delete pendingApprovals[tokenId];
        }
    }

    /// @notice Calculate royalty for a transfer
    /// @return royaltyAmount The royalty amount (for off-chain enforcement)
    /// @return receiver The royalty receiver address
    function getRoyaltyInfo(
        uint256 planId,
        uint256 salePrice
    ) external view returns (uint256 royaltyAmount, address receiver) {
        PlanTransferRule storage rule = planRules[planId];
        if (rule.royaltyBps == 0) return (0, address(0));
        royaltyAmount = (salePrice * rule.royaltyBps) / 10000;
        receiver = rule.royaltyReceiver;
    }
}
