// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title FlagRegistry
/// @notice On-chain registry of feature flag default values for trustless third-party verification.
/// @dev Operators can register/update flags. Default values are stored per teamId (bytes32 hash).
///   Emits events for subgraph indexing. Flags are identified by (teamId, featureKey).
///   This is an append-friendly registry — values can be updated but keys cannot be removed
///   to preserve historical auditability.
contract FlagRegistry is Ownable {

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct FlagEntry {
        bytes32 teamId;       // keccak256 hash of the team's UUID
        string  featureKey;   // e.g., "scan", "advanced-analytics"
        bool    defaultValue; // The flag's default value (overridden by rules at API layer)
        bool    exists;
        uint64  createdAt;
        uint64  updatedAt;
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event FlagRegistered(
        bytes32 indexed teamId,
        string  indexed featureKey,
        bool    defaultValue,
        uint64  createdAt
    );

    event FlagUpdated(
        bytes32 indexed teamId,
        string  indexed featureKey,
        bool    oldValue,
        bool    newValue,
        uint64  updatedAt
    );

    event OperatorAuthorized(bytes32 indexed teamId, address indexed operator);
    event OperatorRevoked(bytes32 indexed teamId, address indexed operator);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice teamId => featureKey => FlagEntry
    mapping(bytes32 => mapping(string => FlagEntry)) private _flags;

    /// @notice teamId => featureKey[] for enumeration
    mapping(bytes32 => string[]) private _flagKeys;

    /// @notice teamId => operator address => authorized
    /// @dev Operators can update flags on behalf of a team (e.g., the ArcenPay backend)
    mapping(bytes32 => mapping(address => bool)) public operators;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor() Ownable(msg.sender) {}

    // ============================================================
    //                      MODIFIER
    // ============================================================

    modifier onlyOperatorOrOwner(bytes32 teamId) {
        require(
            operators[teamId][msg.sender] || msg.sender == owner(),
            "FlagRegistry: not authorized"
        );
        _;
    }

    // ============================================================
    //                    OPERATOR MANAGEMENT
    // ============================================================

    /// @notice Authorize an address as an operator for a team
    function authorizeOperator(bytes32 teamId, address operator) external onlyOwner {
        require(operator != address(0), "FlagRegistry: zero address");
        operators[teamId][operator] = true;
        emit OperatorAuthorized(teamId, operator);
    }

    /// @notice Revoke operator authorization
    function revokeOperator(bytes32 teamId, address operator) external onlyOwner {
        operators[teamId][operator] = false;
        emit OperatorRevoked(teamId, operator);
    }

    // ============================================================
    //                    FLAG MANAGEMENT
    // ============================================================

    /// @notice Register or update a feature flag default value
    /// @param teamId keccak256 of the team UUID (team.id from DB)
    /// @param featureKey The feature flag key (e.g., "scan")
    /// @param defaultValue The default boolean value for this flag
    function setFlag(
        bytes32 teamId,
        string calldata featureKey,
        bool defaultValue
    ) external onlyOperatorOrOwner(teamId) {
        require(bytes(featureKey).length > 0, "FlagRegistry: empty key");
        require(bytes(featureKey).length <= 64, "FlagRegistry: key too long");

        FlagEntry storage entry = _flags[teamId][featureKey];

        if (!entry.exists) {
            entry.teamId      = teamId;
            entry.featureKey  = featureKey;
            entry.defaultValue = defaultValue;
            entry.exists      = true;
            entry.createdAt   = uint64(block.timestamp);
            entry.updatedAt   = uint64(block.timestamp);

            _flagKeys[teamId].push(featureKey);

            emit FlagRegistered(teamId, featureKey, defaultValue, uint64(block.timestamp));
        } else {
            bool old = entry.defaultValue;
            entry.defaultValue = defaultValue;
            entry.updatedAt    = uint64(block.timestamp);

            emit FlagUpdated(teamId, featureKey, old, defaultValue, uint64(block.timestamp));
        }
    }

    /// @notice Batch-set multiple flags for a team (gas efficient for initial sync)
    function setFlags(
        bytes32 teamId,
        string[] calldata featureKeys,
        bool[]   calldata defaultValues
    ) external onlyOperatorOrOwner(teamId) {
        require(featureKeys.length == defaultValues.length, "FlagRegistry: length mismatch");
        for (uint256 i = 0; i < featureKeys.length; i++) {
            _setFlagInternal(teamId, featureKeys[i], defaultValues[i]);
        }
    }

    function _setFlagInternal(bytes32 teamId, string calldata featureKey, bool defaultValue) internal {
        require(bytes(featureKey).length > 0, "FlagRegistry: empty key");
        require(bytes(featureKey).length <= 64, "FlagRegistry: key too long");

        FlagEntry storage entry = _flags[teamId][featureKey];

        if (!entry.exists) {
            entry.teamId      = teamId;
            entry.featureKey  = featureKey;
            entry.defaultValue = defaultValue;
            entry.exists      = true;
            entry.createdAt   = uint64(block.timestamp);
            entry.updatedAt   = uint64(block.timestamp);
            _flagKeys[teamId].push(featureKey);
            emit FlagRegistered(teamId, featureKey, defaultValue, uint64(block.timestamp));
        } else {
            bool old = entry.defaultValue;
            entry.defaultValue = defaultValue;
            entry.updatedAt    = uint64(block.timestamp);
            emit FlagUpdated(teamId, featureKey, old, defaultValue, uint64(block.timestamp));
        }
    }

    // ============================================================
    //                      VIEW FUNCTIONS
    // ============================================================

    /// @notice Get a flag's default value for a team
    /// @return value The default boolean value
    /// @return exists Whether the flag has been registered on-chain
    function getFlag(
        bytes32 teamId,
        string calldata featureKey
    ) external view returns (bool value, bool exists) {
        FlagEntry storage entry = _flags[teamId][featureKey];
        return (entry.defaultValue, entry.exists);
    }

    /// @notice Get all flag keys for a team
    function getFlagKeys(bytes32 teamId) external view returns (string[] memory) {
        return _flagKeys[teamId];
    }

    /// @notice Get full flag entry data
    function getFlagEntry(
        bytes32 teamId,
        string calldata featureKey
    ) external view returns (FlagEntry memory) {
        return _flags[teamId][featureKey];
    }

    /// @notice Get count of flags registered for a team
    function getFlagCount(bytes32 teamId) external view returns (uint256) {
        return _flagKeys[teamId].length;
    }
}
