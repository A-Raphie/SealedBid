// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { SealedBidAuction } from "./SealedBidAuction.sol";

contract AuctionFactory is ZamaEthereumConfig {
    struct AuctionInfo {
        address auctionAddress;
        address creator;
        string itemTitle;
        uint8 category;
        uint256 deadline;
        uint8 status;
        uint256 bidderCount;
    }

    address[] public allAuctions;
    mapping(address => address) public auctionCreators;

    event AuctionCreated(
        address indexed auctionAddress,
        address indexed creator,
        uint8 category,
        string itemTitle
    );

    function createAuction(
        string memory _itemURI,
        string memory _itemTitle,
        string memory _itemDescription,
        address _paymentToken,
        uint256 _durationSeconds,
        uint8 _category,
        address _nftContract,
        uint256 _nftTokenId
    ) external returns (address) {
        SealedBidAuction auction = new SealedBidAuction(
            msg.sender,
            _itemURI,
            _itemTitle,
            _itemDescription,
            _paymentToken,
            _durationSeconds,
            _category,
            _nftContract,
            _nftTokenId
        );

        address auctionAddr = address(auction);
        allAuctions.push(auctionAddr);
        auctionCreators[auctionAddr] = msg.sender;

        emit AuctionCreated(auctionAddr, msg.sender, _category, _itemTitle);

        return auctionAddr;
    }

    function getAuctionCount() external view returns (uint256) {
        return allAuctions.length;
    }

    function getAllAuctions() external view returns (address[] memory) {
        return allAuctions;
    }

    function getAuctionInfo(
        address _auction
    ) external view returns (AuctionInfo memory) {
        SealedBidAuction auction = SealedBidAuction(_auction);
        return
            AuctionInfo({
                auctionAddress: _auction,
                creator: auction.creator(),
                itemTitle: auction.itemTitle(),
                category: uint8(auction.category()),
                deadline: auction.deadline(),
                status: uint8(auction.status()),
                bidderCount: auction.getBidderCount()
            });
    }

    function getAuctionsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        uint256 total = allAuctions.length;
        if (offset >= total) {
            return new address[](0);
        }

        uint256 remaining = total - offset;
        uint256 size = remaining < limit ? remaining : limit;
        address[] memory result = new address[](size);

        for (uint256 i = 0; i < size; i++) {
            result[i] = allAuctions[offset + i];
        }

        return result;
    }
}
