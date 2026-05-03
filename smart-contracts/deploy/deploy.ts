import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFactory = await deploy("AuctionFactory", {
    from: deployer,
    log: true,
  });

  console.log(`AuctionFactory contract: `, deployedFactory.address);
};

export default func;
func.id = "deploy_auction_factory";
func.tags = ["AuctionFactory"];
