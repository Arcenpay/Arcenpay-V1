// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ZKCredentialGate
/// @notice Zero-knowledge credential compliance gate
/// @dev Providers can require subscribers to present valid ZK credentials
///   (e.g., KYC proofs, jurisdiction proofs, accreditation proofs) before
///   accessing gated plan tiers. Verifies zk-SNARK proofs of credential validity
///   without revealing underlying identity data.
contract ZKCredentialGate is Ownable {

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct CredentialType {
        string name;             // e.g., "kyc-basic", "accredited-investor"
        address verifier;        // Groth16 verifier contract address
        bool active;
        uint64 createdAt;
    }

    struct CredentialAttestation {
        bytes32 credentialHash;   // Hash of the credential commitment
        bytes32 nullifier;        // Nullifier to prevent double-use
        uint256 credentialTypeId;
        uint64 attestedAt;
        uint64 expiresAt;
        bool valid;
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event CredentialTypeRegistered(uint256 indexed typeId, string name, address verifier);
    event CredentialVerified(address indexed subscriber, uint256 indexed credentialTypeId, bytes32 nullifier);
    event CredentialRevoked(address indexed subscriber, uint256 indexed credentialTypeId);
    event PlanGateConfigured(uint256 indexed planId, uint256 indexed requiredCredentialType);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Registered credential types
    mapping(uint256 => CredentialType) public credentialTypes;
    uint256 public nextCredentialTypeId;

    /// @notice Subscriber => credential type => attestation
    mapping(address => mapping(uint256 => CredentialAttestation)) private _attestations;

    /// @notice Plan ID => required credential type (0 = no gate)
    mapping(uint256 => uint256) public planGates;

    /// @notice Used nullifiers (prevents double-use of credentials)
    mapping(bytes32 => bool) public usedNullifiers;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor() Ownable(msg.sender) {
        nextCredentialTypeId = 1;
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Register a new credential type with its ZK verifier
    function registerCredentialType(
        string calldata name,
        address verifier
    ) external onlyOwner returns (uint256 typeId) {
        require(bytes(name).length > 0, "ZKCredentialGate: empty name");
        require(verifier != address(0), "ZKCredentialGate: zero verifier");

        typeId = nextCredentialTypeId++;
        credentialTypes[typeId] = CredentialType({
            name: name,
            verifier: verifier,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        emit CredentialTypeRegistered(typeId, name, verifier);
    }

    /// @notice Configure a plan to require a credential type
    function configurePlanGate(uint256 planId, uint256 credentialTypeId) external onlyOwner {
        if (credentialTypeId > 0) {
            require(credentialTypes[credentialTypeId].active, "ZKCredentialGate: invalid type");
        }
        planGates[planId] = credentialTypeId;
        emit PlanGateConfigured(planId, credentialTypeId);
    }

    // ============================================================
    //                  CREDENTIAL VERIFICATION
    // ============================================================

    /// @notice Submit and verify a ZK credential proof
    /// @param credentialTypeId The credential type being presented
    /// @param credentialHash The commitment hash for the credential
    /// @param nullifier The credential nullifier (prevents reuse)
    /// @param proof The Groth16 proof bytes [a, b, c points]
    /// @param publicInputs The public inputs for verification
    /// @param expiresAt When the credential attestation expires
    function verifyCredential(
        uint256 credentialTypeId,
        bytes32 credentialHash,
        bytes32 nullifier,
        bytes calldata proof,
        uint256[] calldata publicInputs,
        uint64 expiresAt
    ) external {
        CredentialType storage credType = credentialTypes[credentialTypeId];
        require(credType.active, "ZKCredentialGate: inactive type");
        require(!usedNullifiers[nullifier], "ZKCredentialGate: nullifier already used");
        require(expiresAt > block.timestamp, "ZKCredentialGate: already expired");

        // Verify proof against the credential type's verifier
        (bool success, bytes memory result) = credType.verifier.staticcall(
            abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[])",
                _decodeProofA(proof),
                _decodeProofB(proof),
                _decodeProofC(proof),
                publicInputs
            )
        );

        require(success && abi.decode(result, (bool)), "ZKCredentialGate: invalid proof");

        // Record attestation
        usedNullifiers[nullifier] = true;
        _attestations[msg.sender][credentialTypeId] = CredentialAttestation({
            credentialHash: credentialHash,
            nullifier: nullifier,
            credentialTypeId: credentialTypeId,
            attestedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            valid: true
        });

        emit CredentialVerified(msg.sender, credentialTypeId, nullifier);
    }

    /// @notice Revoke a credential attestation (by owner or holder)
    function revokeCredential(address subscriber, uint256 credentialTypeId) external {
        require(
            msg.sender == subscriber || msg.sender == owner(),
            "ZKCredentialGate: unauthorized"
        );
        _attestations[subscriber][credentialTypeId].valid = false;
        emit CredentialRevoked(subscriber, credentialTypeId);
    }

    // ============================================================
    //                    GATE CHECK FUNCTIONS
    // ============================================================

    /// @notice Check if a subscriber meets the credential requirement for a plan
    function meetsRequirement(address subscriber, uint256 planId) external view returns (bool) {
        uint256 requiredType = planGates[planId];
        if (requiredType == 0) return true; // No gate configured

        CredentialAttestation storage att = _attestations[subscriber][requiredType];
        return att.valid && att.expiresAt > block.timestamp;
    }

    /// @notice Get a subscriber's attestation for a credential type
    function getAttestation(
        address subscriber,
        uint256 credentialTypeId
    ) external view returns (CredentialAttestation memory) {
        return _attestations[subscriber][credentialTypeId];
    }

    /// @notice Check if a subscriber has any valid credential
    function hasValidCredential(address subscriber, uint256 credentialTypeId) external view returns (bool) {
        CredentialAttestation storage att = _attestations[subscriber][credentialTypeId];
        return att.valid && att.expiresAt > block.timestamp;
    }

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    /// @dev Decode proof point A from raw bytes
    function _decodeProofA(bytes calldata proof) internal pure returns (uint256[2] memory a) {
        require(proof.length >= 256, "ZKCredentialGate: proof too short");
        a[0] = abi.decode(proof[0:32], (uint256));
        a[1] = abi.decode(proof[32:64], (uint256));
    }

    /// @dev Decode proof point B from raw bytes
    function _decodeProofB(bytes calldata proof) internal pure returns (uint256[2][2] memory b) {
        b[0][0] = abi.decode(proof[64:96], (uint256));
        b[0][1] = abi.decode(proof[96:128], (uint256));
        b[1][0] = abi.decode(proof[128:160], (uint256));
        b[1][1] = abi.decode(proof[160:192], (uint256));
    }

    /// @dev Decode proof point C from raw bytes
    function _decodeProofC(bytes calldata proof) internal pure returns (uint256[2] memory c) {
        c[0] = abi.decode(proof[192:224], (uint256));
        c[1] = abi.decode(proof[224:256], (uint256));
    }
}
