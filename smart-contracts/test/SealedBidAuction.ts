import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { SealedBidAuction, SealedBidAuction__factory, AuctionFactory, AuctionFactory__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  creator: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
};

const ONE_HOUR = 3600;
const ZERO_ADDRESS = ethers.ZeroAddress;

async function deployAuctionFixture(signers: Signers) {
  const factory = (await ethers.getContractFactory("SealedBidAuction")) as SealedBidAuction__factory;
  const auction = (await factory.connect(signers.creator).deploy(
    signers.creator.address,
    "ipfs://QmTestItem",
    "Test Painting",
    "A beautiful test painting",
    ZERO_ADDRESS,
    ONE_HOUR,
    0,
    ZERO_ADDRESS,
    0,
  )) as SealedBidAuction;

  const auctionAddress = await auction.getAddress();
  return { auction, auctionAddress };
}

async function deployFactoryFixture() {
  const factory = (await ethers.getContractFactory("AuctionFactory")) as AuctionFactory__factory;
  const factoryContract = (await factory.deploy()) as AuctionFactory;
  const factoryAddress = await factoryContract.getAddress();
  return { factoryContract, factoryAddress };
}

describe("SealedBidAuction", function () {
  let signers: Signers;
  let auction: SealedBidAuction;
  let auctionAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      creator: ethSigners[1],
      alice: ethSigners[2],
      bob: ethSigners[3],
      carol: ethSigners[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite cannot run on Sepolia Testnet");
      this.skip();
    }

    ({ auction, auctionAddress } = await deployAuctionFixture(signers));
  });

  it("should initialize with correct parameters", async function () {
    expect(await auction.creator()).to.eq(signers.creator.address);
    expect(await auction.itemTitle()).to.eq("Test Painting");
    expect(await auction.itemDescription()).to.eq("A beautiful test painting");
    expect(await auction.itemURI()).to.eq("ipfs://QmTestItem");
    expect(await auction.category()).to.eq(0);
    expect(await auction.status()).to.eq(0);
    expect(await auction.getBidderCount()).to.eq(0);
    expect(await auction.deadline()).to.eq(0);
    expect(await auction.durationSeconds()).to.eq(ONE_HOUR);
  });

  it("should allow a bidder to place an encrypted bid", async function () {
    const bidAmount = 100;
    const encrypted = await fhevm
      .createEncryptedInput(auctionAddress, signers.alice.address)
      .add64(bidAmount)
      .encrypt();

    const tx = await auction
      .connect(signers.alice)
      .placeBid(encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    expect(await auction.getBidderCount()).to.eq(1);
    expect(await auction.hasBidder(signers.alice.address)).to.be.true;
    expect(await auction.hasBidder(signers.bob.address)).to.be.false;
  });

  it("should revert if bidder tries to bid twice", async function () {
    const encrypted = await fhevm
      .createEncryptedInput(auctionAddress, signers.alice.address)
      .add64(100)
      .encrypt();

    await auction.connect(signers.alice).placeBid(encrypted.handles[0], encrypted.inputProof);

    const encrypted2 = await fhevm
      .createEncryptedInput(auctionAddress, signers.alice.address)
      .add64(200)
      .encrypt();

    await expect(
      auction.connect(signers.alice).placeBid(encrypted2.handles[0], encrypted2.inputProof),
    ).to.not.be.reverted;

    const bidderCount = await auction.getBidderCount();
    expect(bidderCount).to.equal(1);
  });

  it("should revert endAuction when no bids", async function () {
    await expect(auction.endAuction()).to.be.revertedWithCustomError(auction, "NoBids");
  });

  it("should revert endAuction before deadline after first bid", async function () {
    const encrypted = await fhevm
      .createEncryptedInput(auctionAddress, signers.alice.address)
      .add64(100)
      .encrypt();
    await auction.connect(signers.alice).placeBid(encrypted.handles[0], encrypted.inputProof);

    await expect(auction.endAuction()).to.be.revertedWithCustomError(auction, "AuctionNotEnded");
  });

  it("should find the correct winner with encrypted bids", async function () {
    const aliceBid = 100;
    const bobBid = 250;
    const carolBid = 180;

    const encAlice = await fhevm
      .createEncryptedInput(auctionAddress, signers.alice.address)
      .add64(aliceBid)
      .encrypt();
    await (await auction.connect(signers.alice).placeBid(encAlice.handles[0], encAlice.inputProof)).wait();

    const encBob = await fhevm
      .createEncryptedInput(auctionAddress, signers.bob.address)
      .add64(bobBid)
      .encrypt();
    await (await auction.connect(signers.bob).placeBid(encBob.handles[0], encBob.inputProof)).wait();

    const encCarol = await fhevm
      .createEncryptedInput(auctionAddress, signers.carol.address)
      .add64(carolBid)
      .encrypt();
    await (await auction.connect(signers.carol).placeBid(encCarol.handles[0], encCarol.inputProof)).wait();

    expect(await auction.getBidderCount()).to.eq(3);

    await ethers.provider.send("evm_increaseTime", [ONE_HOUR + 1]);
    await ethers.provider.send("evm_mine");

    await (await auction.endAuction()).wait();

    expect(await auction.status()).to.eq(1);

    const winningBidHandle = await auction.getWinningBid();
    const winningIndexHandle = await auction.getWinningBidderIndex();

    const decryptedBid = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      winningBidHandle,
      auctionAddress,
      signers.creator,
    );
    expect(decryptedBid).to.eq(BigInt(bobBid));

    const decryptedIndex = await fhevm.userDecryptEuint(
      FhevmType.euint16,
      winningIndexHandle,
      auctionAddress,
      signers.creator,
    );
    expect(decryptedIndex).to.eq(BigInt(1));

    await (await auction.connect(signers.creator).settleAuction(signers.bob.address, bobBid)).wait();
    expect(await auction.winner()).to.eq(signers.bob.address);
    expect(await auction.winningBid()).to.eq(BigInt(bobBid));
    expect(await auction.status()).to.eq(2);
  });

  it("should allow creator to cancel an active auction", async function () {
    await (await auction.connect(signers.creator).cancelAuction()).wait();
    expect(await auction.status()).to.eq(3);
  });

  it("should revert cancel from non-creator", async function () {
    await expect(
      auction.connect(signers.alice).cancelAuction(),
    ).to.be.revertedWithCustomError(auction, "NotCreator");
  });

  it("should return max time remaining when no bids", async function () {
    const remaining = await auction.timeRemaining();
    expect(remaining).to.eq(ethers.MaxUint256);
  });

  describe("timer on first bid", function () {
    it("should set deadline on first bid", async function () {
      expect(await auction.deadline()).to.eq(0);

      const encrypted = await fhevm
        .createEncryptedInput(auctionAddress, signers.alice.address)
        .add64(100)
        .encrypt();
      await auction.connect(signers.alice).placeBid(encrypted.handles[0], encrypted.inputProof);

      const deadline = await auction.deadline();
      const block = await ethers.provider.getBlock("latest");
      expect(deadline).to.eq(BigInt(block!.timestamp) + BigInt(ONE_HOUR));
    });

    it("should not change deadline on second bid", async function () {
      const enc1 = await fhevm
        .createEncryptedInput(auctionAddress, signers.alice.address)
        .add64(100)
        .encrypt();
      await auction.connect(signers.alice).placeBid(enc1.handles[0], enc1.inputProof);

      const deadlineAfterFirst = await auction.deadline();

      const enc2 = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(200)
        .encrypt();
      await auction.connect(signers.bob).placeBid(enc2.handles[0], enc2.inputProof);

      const deadlineAfterSecond = await auction.deadline();
      expect(deadlineAfterFirst).to.eq(deadlineAfterSecond);
    });

    it("should allow endAuction after deadline with bids", async function () {
      const encrypted = await fhevm
        .createEncryptedInput(auctionAddress, signers.alice.address)
        .add64(100)
        .encrypt();
      await auction.connect(signers.alice).placeBid(encrypted.handles[0], encrypted.inputProof);

      await ethers.provider.send("evm_increaseTime", [ONE_HOUR + 1]);
      await ethers.provider.send("evm_mine");

      await auction.endAuction();
      expect(await auction.status()).to.eq(1);
    });

    it("should revert bid after deadline", async function () {
      const enc1 = await fhevm
        .createEncryptedInput(auctionAddress, signers.alice.address)
        .add64(100)
        .encrypt();
      await auction.connect(signers.alice).placeBid(enc1.handles[0], enc1.inputProof);

      await ethers.provider.send("evm_increaseTime", [ONE_HOUR + 1]);
      await ethers.provider.send("evm_mine");

      const enc2 = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(200)
        .encrypt();
      await expect(
        auction.connect(signers.bob).placeBid(enc2.handles[0], enc2.inputProof),
      ).to.be.revertedWithCustomError(auction, "AuctionAlreadyEnded");
    });
  });
});

describe("AuctionFactory", function () {
  let signers: Signers;
  let factoryContract: AuctionFactory;
  let factoryAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      creator: ethSigners[1],
      alice: ethSigners[2],
      bob: ethSigners[3],
      carol: ethSigners[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite cannot run on Sepolia Testnet");
      this.skip();
    }

    ({ factoryContract, factoryAddress } = await deployFactoryFixture());
  });

  it("should start with zero auctions", async function () {
    expect(await factoryContract.getAuctionCount()).to.eq(0);
  });

  it("should create a new auction", async function () {
    const tx = await factoryContract.connect(signers.creator).createAuction(
      "ipfs://QmTest",
      "Test Item",
      "Test Description",
      ZERO_ADDRESS,
      ONE_HOUR,
      0,
      ZERO_ADDRESS,
      0,
    );
    const receipt = await tx.wait();

    expect(await factoryContract.getAuctionCount()).to.eq(1);

    const auctions = await factoryContract.getAllAuctions();
    expect(auctions.length).to.eq(1);

    const info = await factoryContract.getAuctionInfo(auctions[0]);
    expect(info.creator).to.eq(signers.creator.address);
    expect(info.itemTitle).to.eq("Test Item");
    expect(info.category).to.eq(0);
    expect(info.status).to.eq(0);
  });

  it("should create multiple auctions and paginate", async function () {
    for (let i = 0; i < 3; i++) {
      await factoryContract.connect(signers.creator).createAuction(
        `ipfs://QmTest${i}`,
        `Item ${i}`,
        `Description ${i}`,
        ZERO_ADDRESS,
        ONE_HOUR,
        i % 5,
        ZERO_ADDRESS,
        0,
      );
    }

    expect(await factoryContract.getAuctionCount()).to.eq(3);

    const page = await factoryContract.getAuctionsPaginated(1, 2);
    expect(page.length).to.eq(2);
  });
});
