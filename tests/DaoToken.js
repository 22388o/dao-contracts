const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const timeMachine = require("ganache-time-traveler");
const { ZERO_ADDRESS, tokenAmountToBigNumber } = require("./utils");
const { deployMockContract } = require("@ethereum-waffle/mock-contract");

describe("DaoToken deployment", () => {
  // contract factories
  let DaoToken;

  // deployed contracts
  let daoToken;

  // use EVM snapshots for test isolation
  let snapshotId;

  beforeEach(async () => {
    let snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot["result"];
  });

  afterEach(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  it("Can deploy DAO token", async () => {
    DaoToken = await ethers.getContractFactory("DaoToken");
    const logic = await DaoToken.deploy();

    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin");
    const proxyAdmin = await ProxyAdmin.deploy();

    const TransparentUpgradeableProxy = await ethers.getContractFactory(
      "TransparentUpgradeableProxy"
    );
    const initData = logic.interface.encodeFunctionData("initialize()", []);
    daoToken = await expect(
      TransparentUpgradeableProxy.deploy(
        logic.address,
        proxyAdmin.address,
        initData
      )
    ).to.not.be.reverted;
    expect(daoToken.address).to.not.equal(ZERO_ADDRESS);
  });
});

describe("DaoToken unit tests", () => {
  // signers
  let deployer;
  let minter;
  let randomUser;

  // deployed contracts
  let daoToken;

  // use EVM snapshots for test isolation
  let snapshotId;

  beforeEach(async () => {
    let snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot["result"];
  });

  afterEach(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  before("Get signers", async () => {
    [deployer, minter, randomUser] = await ethers.getSigners();
  });

  before("Deploy DAO token", async () => {
    const DaoToken = await ethers.getContractFactory("DaoToken");
    const logic = await DaoToken.deploy();

    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin");
    const proxyAdmin = await ProxyAdmin.deploy();

    const TransparentUpgradeableProxy = await ethers.getContractFactory(
      "TransparentUpgradeableProxy"
    );
    const initData = logic.interface.encodeFunctionData("initialize()", []);
    const proxy = await TransparentUpgradeableProxy.deploy(
      logic.address,
      proxyAdmin.address,
      initData
    );
    daoToken = logic.attach(proxy.address);
  });

  describe("initialize", () => {
    it("Symbol", async () => {
      expect(await daoToken.symbol()).to.equal("CXD");
    });

    it("Name", async () => {
      expect(await daoToken.name()).to.equal("Cortex DAO Token");
    });

    it("Decimals", async () => {
      expect(await daoToken.decimals()).to.equal(18);
    });

    it("Deployer is owner", async () => {
      expect(await daoToken.owner()).to.equal(deployer.address);
    });

    it("Initial supply cap is 271,828,182", async () => {
      const expectedSupplyCap = tokenAmountToBigNumber("271828182");
      expect(await daoToken.supplyCap()).to.equal(expectedSupplyCap);
    });
  });

  describe("setMinter", () => {
    it("Permissioned can set minter", async () => {
      const contract = await deployMockContract(deployer, []);
      await expect(daoToken.connect(deployer).setMinter(contract.address)).to
        .not.be.reverted;
    });

    it("Unpermissioned cannot set minter", async () => {
      const contract = await deployMockContract(deployer, []);
      await expect(
        daoToken.connect(randomUser).setMinter(contract.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Cannot set to zero address", async () => {
      await expect(
        daoToken.connect(deployer).setMinter(ZERO_ADDRESS)
      ).to.be.revertedWith("INVALID_ADDRESS");
    });
  });

  describe("mint", () => {
    before("Set minter", async () => {
      await daoToken.connect(deployer).setMinter(minter.address);
    });

    it("Permissioned can mint", async () => {
      await expect(daoToken.connect(minter).mint(randomUser.address, 1)).to.not
        .be.reverted;
    });

    it("Unpermissioned cannot mint", async () => {
      await expect(
        daoToken.connect(randomUser).mint(randomUser.address, 1)
      ).to.be.revertedWith("MINTER_ONLY");
    });

    it("Cannot mint beyond supply cap", async () => {
      const supplyCap = await daoToken.supplyCap();
      const mintAmount = supplyCap.add(1);
      await expect(
        daoToken.connect(minter).mint(randomUser.address, mintAmount)
      ).to.be.revertedWith("SUPPLY_CAP_EXCEEDED");

      const halfSupplyCap = supplyCap.div(2);
      await daoToken.connect(minter).mint(randomUser.address, halfSupplyCap);

      await expect(
        daoToken.connect(minter).mint(randomUser.address, halfSupplyCap.add(2))
      ).to.be.revertedWith("SUPPLY_CAP_EXCEEDED");
    });
  });

  describe("setSupplyCap", () => {
    it("Permissioned can set", async () => {
      await expect(
        daoToken.connect(deployer).setSupplyCap(tokenAmountToBigNumber("100"))
      ).to.not.be.reverted;
    });

    it("Unpermissioned cannot set", async () => {
      await expect(
        daoToken.connect(randomUser).setSupplyCap(tokenAmountToBigNumber("100"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Cannot set zero cap", async () => {
      await expect(daoToken.setSupplyCap(0)).to.be.revertedWith(
        "ZERO_SUPPLY_CAP"
      );
    });

    it("Cannot set cap lower than total supply", async () => {
      // ensure we have some supply
      await daoToken.connect(deployer).setMinter(minter.address);
      await daoToken
        .connect(minter)
        .mint(randomUser.address, tokenAmountToBigNumber("100"));

      const totalSupply = await daoToken.totalSupply();
      const newSupply = totalSupply.sub(1);
      await expect(daoToken.setSupplyCap(newSupply)).to.be.revertedWith(
        "INVALID_SUPPLY_CAP"
      );
    });
  });
});
