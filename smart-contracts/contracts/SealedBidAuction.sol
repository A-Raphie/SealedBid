// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {
    FHE,
    euint64,
    euint16,
    ebool,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SealedBidAuction is ZamaEthereumConfig {
    enum AuctionStatus {
        Active,
        Ended,
        Settled,
        Canceled
    }

    enum AuctionCategory {
        NFT,
        PROCUREMENT,
        REAL_ESTATE,
        FREELANCE,
        COMMODITY
    }

    address public immutable creator;
    string public itemURI;
    string public itemTitle;
    string public itemDescription;
    address public paymentToken;
    uint256 public durationSeconds;
    uint256 public deadline;
    AuctionCategory public category;
    AuctionStatus public status;
    uint256 public createdAt;

    address public nftContract;
    uint256 public nftTokenId;

    address[] public bidders;
    mapping(address => euint64) public encryptedBids;
    mapping(address => bool) public hasBid;

    euint64 internal _winningBid;
    euint16 internal _winningBidderIndex;
    address public winner;
    uint64 public winningBid;
    bool public resultsComputed;

    uint256 public constant MAX_BIDDERS = 50;

    event BidPlaced(address indexed bidder, uint256 timestamp);
    event AuctionEnded(uint256 bidderCount);
    event AuctionSettled(address indexed winner);
    event AuctionCanceled();

    error AuctionNotActive();
    error AuctionAlreadyEnded();
    error AuctionNotEnded();
    error AlreadyBid();
    error NoBids();
    error NotCreator();
    error ResultsNotComputed();
    error TooManyBidders();

    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    modifier onlyActive() {
        if (status != AuctionStatus.Active) revert AuctionNotActive();
        _;
    }

    constructor(
        address _creator,
        string memory _itemURI,
        string memory _itemTitle,
        string memory _itemDescription,
        address _paymentToken,
        uint256 _durationSeconds,
        uint8 _category,
        address _nftContract,
        uint256 _nftTokenId
    ) {
        creator = _creator;
        itemURI = _itemURI;
        itemTitle = _itemTitle;
        itemDescription = _itemDescription;
        paymentToken = _paymentToken;
        durationSeconds = _durationSeconds;
        deadline = 0;
        category = AuctionCategory(_category);
        status = AuctionStatus.Active;
        createdAt = block.timestamp;
        nftContract = _nftContract;
        nftTokenId = _nftTokenId;
    }

    function placeBid(
        externalEuint64 inputBid,
        bytes calldata inputProof
    ) external onlyActive {
        if (deadline > 0 && block.timestamp >= deadline) revert AuctionAlreadyEnded();
        if (bidders.length >= MAX_BIDDERS && !hasBid[msg.sender]) revert TooManyBidders();

        if (deadline == 0) {
            deadline = block.timestamp + durationSeconds;
        }

        euint64 bid = FHE.fromExternal(inputBid, inputProof);

        encryptedBids[msg.sender] = bid;

        if (!hasBid[msg.sender]) {
            hasBid[msg.sender] = true;
            bidders.push(msg.sender);
        }

        FHE.allowThis(bid);
        FHE.allow(bid, msg.sender);
        FHE.allow(bid, creator);

        emit BidPlaced(msg.sender, block.timestamp);
    }

    function endAuction() external {
        if (block.timestamp < deadline) revert AuctionNotEnded();
        if (status != AuctionStatus.Active) revert AuctionNotActive();
        if (bidders.length == 0) revert NoBids();

        euint64 currentMax = encryptedBids[bidders[0]];
        euint16 currentWinnerIdx = FHE.asEuint16(uint16(0));

        for (uint256 i = 1; i < bidders.length; i++) {
            euint64 challenger = encryptedBids[bidders[i]];
            ebool isGreater = FHE.gt(challenger, currentMax);

            currentMax = FHE.select(isGreater, challenger, currentMax);

            euint16 idxEnc = FHE.asEuint16(uint16(i));
            currentWinnerIdx = FHE.select(
                isGreater,
                idxEnc,
                currentWinnerIdx
            );
        }

        _winningBid = currentMax;
        _winningBidderIndex = currentWinnerIdx;
        resultsComputed = true;

        FHE.allowThis(_winningBid);
        FHE.allow(_winningBid, creator);
        FHE.allowThis(_winningBidderIndex);
        FHE.allow(_winningBidderIndex, creator);

        for (uint256 i = 0; i < bidders.length; i++) {
            FHE.allow(_winningBid, bidders[i]);
            FHE.allow(_winningBidderIndex, bidders[i]);
        }

        status = AuctionStatus.Ended;

        emit AuctionEnded(bidders.length);
    }

    function settleAuction(address _winner, uint64 _bidAmount) external onlyCreator {
        if (status != AuctionStatus.Ended) revert AuctionNotEnded();
        if (!resultsComputed) revert ResultsNotComputed();

        winner = _winner;
        winningBid = _bidAmount;
        status = AuctionStatus.Settled;

        emit AuctionSettled(_winner);
    }

    function cancelAuction() external onlyCreator onlyActive {
        status = AuctionStatus.Canceled;

        emit AuctionCanceled();
    }

    function getBidderCount() external view returns (uint256) {
        return bidders.length;
    }

    function hasBidder(address bidder) external view returns (bool) {
        return hasBid[bidder];
    }

    function getBid(address bidder) external view returns (euint64) {
        return encryptedBids[bidder];
    }

    function getWinningBid() external view returns (euint64) {
        return _winningBid;
    }

    function getWinningBidderIndex() external view returns (euint16) {
        return _winningBidderIndex;
    }

    function getBidders() external view returns (address[] memory) {
        return bidders;
    }

    function timeRemaining() external view returns (uint256) {
        if (deadline == 0) return type(uint256).max;
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }
}
