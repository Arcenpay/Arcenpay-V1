// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MultisigVerifier
/// @notice Experimental/frozen contract. Preserved for future work and not part of the current launch runtime.
/// @notice EIP-1271 compatible signature verifier for Safe/Gnosis multisig wallets
/// @dev Allows the SubscriptionRegistry and CheckoutModal to accept signatures
///   from smart contract wallets (Safe, Argent, etc.) in addition to EOAs.
contract MultisigVerifier is Ownable {
    /// @notice EIP-1271 magic value for valid signatures
    bytes4 public constant EIP1271_MAGIC = 0x1626ba7e;

    /// @notice Registered multisig wallets allowed to subscribe
    mapping(address => bool) public registeredMultisigs;

    /// @notice Multisig address => delegate signer(s) authorized to sign on behalf
    mapping(address => mapping(address => bool)) public authorizedDelegates;

    // ============================================================
    //                          EVENTS
    // ============================================================

    event MultisigRegistered(address indexed multisig, address indexed registeredBy);
    event MultisigRevoked(address indexed multisig);
    event DelegateAuthorized(address indexed multisig, address indexed delegate);
    event DelegateRevoked(address indexed multisig, address indexed delegate);
    event SignatureVerified(address indexed signer, bytes32 indexed hash, bool valid);

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor() Ownable(msg.sender) {}

    // ============================================================
    //                    REGISTRATION
    // ============================================================

    /// @notice Register a multisig wallet for protocol participation
    /// @param multisig The Safe/Gnosis multisig address
    function registerMultisig(address multisig) external {
        require(multisig != address(0), "MultisigVerifier: zero address");
        require(!registeredMultisigs[multisig], "MultisigVerifier: already registered");

        // Verify the caller is either the multisig itself or the contract owner
        require(
            msg.sender == multisig || msg.sender == owner(),
            "MultisigVerifier: unauthorized"
        );

        registeredMultisigs[multisig] = true;
        emit MultisigRegistered(multisig, msg.sender);
    }

    /// @notice Revoke a multisig registration
    function revokeMultisig(address multisig) external {
        require(
            msg.sender == multisig || msg.sender == owner(),
            "MultisigVerifier: unauthorized"
        );
        registeredMultisigs[multisig] = false;
        emit MultisigRevoked(multisig);
    }

    /// @notice Authorize a delegate signer for a multisig
    /// @param multisig The multisig wallet
    /// @param delegate The authorized delegate EOA
    function authorizeDelegate(address multisig, address delegate) external {
        require(
            msg.sender == multisig || msg.sender == owner(),
            "MultisigVerifier: unauthorized"
        );
        require(registeredMultisigs[multisig], "MultisigVerifier: not registered");
        authorizedDelegates[multisig][delegate] = true;
        emit DelegateAuthorized(multisig, delegate);
    }

    /// @notice Revoke a delegate's authorization
    function revokeDelegate(address multisig, address delegate) external {
        require(
            msg.sender == multisig || msg.sender == owner(),
            "MultisigVerifier: unauthorized"
        );
        authorizedDelegates[multisig][delegate] = false;
        emit DelegateRevoked(multisig, delegate);
    }

    // ============================================================
    //                  EIP-1271 VERIFICATION
    // ============================================================

    /// @notice Verify a signature from an EIP-1271 compatible contract wallet
    /// @param signer The contract wallet address (Safe/Gnosis)
    /// @param hash The message hash
    /// @param signature The signature bytes
    /// @return valid True if signature is valid
    function verifyContractSignature(
        address signer,
        bytes32 hash,
        bytes calldata signature
    ) external returns (bool valid) {
        require(registeredMultisigs[signer], "MultisigVerifier: not registered");

        // Call EIP-1271 isValidSignature on the contract wallet
        (bool success, bytes memory result) = signer.staticcall(
            abi.encodeWithSelector(EIP1271_MAGIC, hash, signature)
        );

        valid = success &&
            result.length >= 32 &&
            abi.decode(result, (bytes4)) == EIP1271_MAGIC;

        emit SignatureVerified(signer, hash, valid);
    }

    /// @notice Check if an address is a registered multisig or authorized delegate
    function isAuthorized(address wallet, address signer) external view returns (bool) {
        if (registeredMultisigs[wallet] && wallet == signer) return true;
        if (authorizedDelegates[wallet][signer]) return true;
        return false;
    }
}
