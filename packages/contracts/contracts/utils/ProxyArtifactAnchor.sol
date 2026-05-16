// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Compile-time anchor so Hardhat emits the ERC1967Proxy artifact used by scripts/deploy.ts.
contract ProxyArtifactAnchor {
    function deploy(address implementation, bytes calldata data) external returns (address) {
        ERC1967Proxy proxy = new ERC1967Proxy(implementation, data);
        return address(proxy);
    }
}
