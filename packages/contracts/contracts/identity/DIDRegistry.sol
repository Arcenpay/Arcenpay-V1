// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DIDRegistry
/// @notice Experimental/frozen contract. Preserved for future work and not part of the current launch runtime.
/// @notice Decentralized identity registry with agent reputation scoring
/// @dev Maps wallet addresses to DID documents and tracks on-chain reputation
///   based on protocol participation (subscriptions, settlements, proof submissions).
contract DIDRegistry is Ownable {

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct DIDDocument {
        string did;              // DID string (e.g., did:arcenpay:0x1234...)
        address controller;       // Controlling wallet address
        uint64 createdAt;
        uint64 updatedAt;
        bool active;
    }

    struct ReputationScore {
        uint256 totalSubscriptions;    // Number of subscriptions purchased
        uint256 totalSettlements;      // Number of successful settlements
        uint256 totalProofsSubmitted;  // Number of valid ZK proofs submitted
        uint256 totalVolume;           // Total USDC volume (in atomic units)
        uint256 failedPayments;        // Number of failed payments
        uint256 slashEvents;           // Number of slash/penalty events
        uint64 firstActivity;          // Timestamp of first on-chain activity
        uint64 lastActivity;           // Timestamp of most recent activity
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event DIDRegistered(address indexed controller, string did);
    event DIDUpdated(address indexed controller, string did);
    event DIDDeactivated(address indexed controller);
    event ReputationUpdated(address indexed agent, string field, uint256 newValue);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Controller address => DID document
    mapping(address => DIDDocument) private _dids;

    /// @notice Agent/wallet address => reputation score
    mapping(address => ReputationScore) private _reputation;

    /// @notice Tracks whether reputation timestamps have been initialized
    mapping(address => bool) private _reputationInitialized;

    /// @notice Authorized contracts that can update reputation scores
    mapping(address => bool) public authorizedUpdaters;

    /// @notice DID string => controller address (reverse lookup)
    mapping(string => address) private _didToController;

    /// @notice Total registered DIDs
    uint256 public totalDIDs;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor() Ownable(msg.sender) {}

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Authorize a contract to update reputation scores
    function authorizeUpdater(address updater) external onlyOwner {
        require(updater != address(0), "DIDRegistry: zero updater");
        authorizedUpdaters[updater] = true;
    }

    /// @notice Revoke updater authorization
    function revokeUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = false;
    }

    modifier onlyUpdater() {
        require(authorizedUpdaters[msg.sender] || msg.sender == owner(), "DIDRegistry: unauthorized");
        _;
    }

    // ============================================================
    //                    DID MANAGEMENT
    // ============================================================

    /// @notice Register a new DID for the caller
    function registerDID(string calldata did) external {
        require(bytes(did).length > 0, "DIDRegistry: empty DID");
        require(!_dids[msg.sender].active, "DIDRegistry: already registered");
        require(_didToController[did] == address(0), "DIDRegistry: DID already claimed");

        _dids[msg.sender] = DIDDocument({
            did: did,
            controller: msg.sender,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            active: true
        });

        _didToController[did] = msg.sender;
        totalDIDs++;

        // Initialize reputation
        _reputation[msg.sender].firstActivity = uint64(block.timestamp);
        _reputation[msg.sender].lastActivity = uint64(block.timestamp);
        _reputationInitialized[msg.sender] = true;

        emit DIDRegistered(msg.sender, did);
    }

    /// @notice Update the caller's DID document
    function updateDID(string calldata newDid) external {
        require(_dids[msg.sender].active, "DIDRegistry: not registered");
        require(bytes(newDid).length > 0, "DIDRegistry: empty DID");

        string memory oldDid = _dids[msg.sender].did;
        delete _didToController[oldDid];

        require(_didToController[newDid] == address(0), "DIDRegistry: DID already claimed");

        _dids[msg.sender].did = newDid;
        _dids[msg.sender].updatedAt = uint64(block.timestamp);
        _didToController[newDid] = msg.sender;

        emit DIDUpdated(msg.sender, newDid);
    }

    /// @notice Deactivate the caller's DID
    function deactivateDID() external {
        require(_dids[msg.sender].active, "DIDRegistry: not registered");
        _dids[msg.sender].active = false;
        emit DIDDeactivated(msg.sender);
    }

    // ============================================================
    //                  REPUTATION SCORING
    // ============================================================

    /// @notice Record a subscription event for reputation
    function recordSubscription(address agent, uint256 volume) external onlyUpdater {
        ReputationScore storage rep = _reputation[agent];
        _touchReputation(agent, rep);
        rep.totalSubscriptions++;
        rep.totalVolume += volume;
        emit ReputationUpdated(agent, "subscription", rep.totalSubscriptions);
    }

    /// @notice Record a settlement event
    function recordSettlement(address agent, uint256 amount) external onlyUpdater {
        ReputationScore storage rep = _reputation[agent];
        _touchReputation(agent, rep);
        rep.totalSettlements++;
        rep.totalVolume += amount;
        emit ReputationUpdated(agent, "settlement", rep.totalSettlements);
    }

    /// @notice Record a proof submission
    function recordProofSubmission(address agent) external onlyUpdater {
        ReputationScore storage rep = _reputation[agent];
        _touchReputation(agent, rep);
        rep.totalProofsSubmitted++;
        emit ReputationUpdated(agent, "proof", rep.totalProofsSubmitted);
    }

    /// @notice Record a failed payment
    function recordFailedPayment(address agent) external onlyUpdater {
        ReputationScore storage rep = _reputation[agent];
        _touchReputation(agent, rep);
        rep.failedPayments++;
        emit ReputationUpdated(agent, "failedPayment", rep.failedPayments);
    }

    /// @notice Record a slash/penalty event
    function recordSlash(address agent) external onlyUpdater {
        ReputationScore storage rep = _reputation[agent];
        _touchReputation(agent, rep);
        rep.slashEvents++;
        emit ReputationUpdated(agent, "slash", rep.slashEvents);
    }

    function _touchReputation(address agent, ReputationScore storage rep) internal {
        if (!_reputationInitialized[agent]) {
            rep.firstActivity = uint64(block.timestamp);
            _reputationInitialized[agent] = true;
        }

        rep.lastActivity = uint64(block.timestamp);
    }

    // ============================================================
    //                    QUERY FUNCTIONS
    // ============================================================

    /// @notice Get a DID document for an address
    function getDID(address controller) external view returns (DIDDocument memory) {
        return _dids[controller];
    }

    /// @notice Resolve a DID string to its controller address
    function resolveDID(string calldata did) external view returns (address) {
        return _didToController[did];
    }

    /// @notice Get the reputation score for an agent
    function getReputation(address agent) external view returns (ReputationScore memory) {
        return _reputation[agent];
    }

    /// @notice Calculate a composite reputation score (0-1000)
    /// @dev Score formula: subscriptions * 10 + settlements * 5 + proofs * 20 - failures * 50 - slashes * 100
    function getReputationScore(address agent) external view returns (uint256 score) {
        ReputationScore storage rep = _reputation[agent];

        uint256 positive = (rep.totalSubscriptions * 10) +
            (rep.totalSettlements * 5) +
            (rep.totalProofsSubmitted * 20);

        uint256 negative = (rep.failedPayments * 50) +
            (rep.slashEvents * 100);

        if (positive > negative) {
            score = positive - negative;
            if (score > 1000) score = 1000;
        }
    }

    /// @notice Check if an address has a registered DID
    function hasDID(address controller) external view returns (bool) {
        return _dids[controller].active;
    }
}
