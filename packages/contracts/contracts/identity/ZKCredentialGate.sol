// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ZKCredentialGate
/// @notice Experimental/frozen contract. Preserved for future work and not part of the current launch runtime.
/// @notice Zero-knowledge credential compliance gate with Reclaim Protocol zkTLS support.
/// @dev Providers can require subscribers to present valid ZK credentials
///   (e.g., KYC proofs, jurisdiction proofs, accreditation proofs) before
///   accessing gated plan tiers. Verifies zk-SNARK proofs of credential validity
///   without revealing underlying identity data.
///
///   Supports two proof modes:
///   1. Groth16 ZK-SNARK proofs (on-chain verifier contracts)
///   2. Reclaim Protocol zkTLS proofs (attestor signature verification)
///      — bridges Web2 data (subscription status, API usage) to Web3 trustlessly
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

    // ── Reclaim Protocol zkTLS ────────────────────────────────────────────────

    struct ReclaimAttestation {
        bytes32  providerId;   // keccak256 of the Reclaim provider ID string
        string   providerName; // human-readable provider name
        bytes32  claimHash;    // keccak256 of serialized claim data
        bytes32  proofHash;    // unique proof identifier (prevents replay)
        uint64   verifiedAt;
        uint64   expiresAt;
        bool     valid;
    }

    /// @notice Known Reclaim attestor addresses (multi-attestor support)
    mapping(address => bool) public reclaimAttestors;

    /// @notice subscriber => providerId => ReclaimAttestation
    mapping(address => mapping(bytes32 => ReclaimAttestation)) private _reclaimAttestations;

    /// @notice Used Reclaim proof hashes (replay prevention)
    mapping(bytes32 => bool) public usedReclaimProofHashes;

    /// @notice Plan ID => required Reclaim provider ID (0 = not required)
    mapping(uint256 => bytes32) public planReclaimGates;

    event ReclaimAttestorAdded(address indexed attestor);
    event ReclaimAttestorRemoved(address indexed attestor);
    event ReclaimProofVerified(
        address indexed subscriber,
        bytes32 indexed providerId,
        bytes32 proofHash,
        uint64  expiresAt
    );
    event ReclaimProofRevoked(address indexed subscriber, bytes32 indexed providerId);
    event PlanReclaimGateConfigured(uint256 indexed planId, bytes32 indexed providerId);

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
    //              RECLAIM PROTOCOL ZKТLS FUNCTIONS
    // ============================================================

    /// @notice Add a trusted Reclaim attestor address
    function addReclaimAttestor(address attestor) external onlyOwner {
        require(attestor != address(0), "ZKCredentialGate: zero attestor");
        reclaimAttestors[attestor] = true;
        emit ReclaimAttestorAdded(attestor);
    }

    /// @notice Remove a Reclaim attestor
    function removeReclaimAttestor(address attestor) external onlyOwner {
        reclaimAttestors[attestor] = false;
        emit ReclaimAttestorRemoved(attestor);
    }

    /// @notice Configure a plan to require a Reclaim zkTLS claim
    /// @param planId The on-chain plan ID
    /// @param providerId keccak256 of the Reclaim provider ID string (e.g., keccak256("github-stars"))
    function configurePlanReclaimGate(uint256 planId, bytes32 providerId) external onlyOwner {
        planReclaimGates[planId] = providerId;
        emit PlanReclaimGateConfigured(planId, providerId);
    }

    /// @notice Submit a verified Reclaim Protocol zkTLS proof on-chain
    /// @dev The proof must be pre-verified off-chain by the ArcenPay backend.
    ///   The backend submits the proof hash + claim data + attestor signature.
    ///   On-chain we verify the attestor signature and record the attestation.
    /// @param providerId keccak256 of the Reclaim provider ID
    /// @param providerName Human-readable provider name
    /// @param claimHash keccak256 of the serialized claim data
    /// @param proofHash Unique identifier for this proof (prevents replay)
    /// @param expiresAt When the zkTLS attestation expires (0 = no expiry)
    /// @param attestorSig ECDSA signature from a trusted Reclaim attestor
    function submitReclaimProof(
        bytes32 providerId,
        string  calldata providerName,
        bytes32 claimHash,
        bytes32 proofHash,
        uint64  expiresAt,
        bytes   calldata attestorSig
    ) external {
        require(!usedReclaimProofHashes[proofHash], "ZKCredentialGate: proof already used");
        require(expiresAt == 0 || expiresAt > block.timestamp, "ZKCredentialGate: proof expired");

        // Reconstruct the signed message
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(providerId, claimHash, proofHash, msg.sender, expiresAt))
        ));

        // Recover attestor address from signature
        address attestor = _recoverSigner(messageHash, attestorSig);
        require(reclaimAttestors[attestor], "ZKCredentialGate: unknown attestor");

        // Mark proof as used
        usedReclaimProofHashes[proofHash] = true;

        // Record attestation
        _reclaimAttestations[msg.sender][providerId] = ReclaimAttestation({
            providerId:   providerId,
            providerName: providerName,
            claimHash:    claimHash,
            proofHash:    proofHash,
            verifiedAt:   uint64(block.timestamp),
            expiresAt:    expiresAt,
            valid:        true
        });

        emit ReclaimProofVerified(msg.sender, providerId, proofHash, expiresAt);
    }

    /// @notice Revoke a Reclaim attestation
    function revokeReclaimAttestation(address subscriber, bytes32 providerId) external {
        require(
            msg.sender == subscriber || msg.sender == owner(),
            "ZKCredentialGate: unauthorized"
        );
        _reclaimAttestations[subscriber][providerId].valid = false;
        emit ReclaimProofRevoked(subscriber, providerId);
    }

    /// @notice Check if a subscriber meets the Reclaim requirement for a plan
    function meetsReclaimRequirement(address subscriber, uint256 planId) external view returns (bool) {
        bytes32 requiredProvider = planReclaimGates[planId];
        if (requiredProvider == bytes32(0)) return true; // No gate

        ReclaimAttestation storage att = _reclaimAttestations[subscriber][requiredProvider];
        return att.valid && (att.expiresAt == 0 || att.expiresAt > block.timestamp);
    }

    /// @notice Get a subscriber's Reclaim attestation for a provider
    function getReclaimAttestation(
        address subscriber,
        bytes32 providerId
    ) external view returns (ReclaimAttestation memory) {
        return _reclaimAttestations[subscriber][providerId];
    }

    /// @notice Check if a subscriber has a valid Reclaim claim for a provider
    function hasValidReclaimClaim(address subscriber, bytes32 providerId) external view returns (bool) {
        ReclaimAttestation storage att = _reclaimAttestations[subscriber][providerId];
        return att.valid && (att.expiresAt == 0 || att.expiresAt > block.timestamp);
    }

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    /// @dev Recover ECDSA signer from a pre-hashed message and signature.
    ///
    /// Hardening applied here:
    ///  - `s` must be in the lower half of the curve order. Without this check a
    ///    valid signature can be trivially mutated (`s' = n - s`, `v` flipped)
    ///    into a SECOND valid signature for the same message. Anywhere a
    ///    signature is used as a replay/dedup key that mutation is a bypass.
    ///  - The recovered address must not be `address(0)`. `ecrecover` returns
    ///    `address(0)` for malformed input, so a caller that compares the result
    ///    against an unset (zero) expected signer would accept a forged
    ///    signature.
    function _recoverSigner(bytes32 messageHash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "ZKCredentialGate: invalid sig length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "ZKCredentialGate: invalid v");
        // secp256k1n / 2 — reject high-s (malleable) signatures.
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "ZKCredentialGate: invalid s"
        );

        address recovered = ecrecover(messageHash, v, r, s);
        require(recovered != address(0), "ZKCredentialGate: invalid signature");
        return recovered;
    }

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
