// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title UpgradeableReentrancyGuard
/// @notice Minimal reentrancy guard with initializer support for proxy deployments.
abstract contract UpgradeableReentrancyGuard is Initializable {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _reentrancyStatus;

    error ReentrancyGuardReentrantCall();

    function __UpgradeableReentrancyGuard_init() internal onlyInitializing {
        _reentrancyStatus = NOT_ENTERED;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        _reentrancyStatus = ENTERED;
        _;
        _reentrancyStatus = NOT_ENTERED;
    }
}
