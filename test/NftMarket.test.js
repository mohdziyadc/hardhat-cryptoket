const { assert, expect } = require("chai")
const { network, ethers, deployments } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("NFT Market Unit Tests", () => {
          let nftMarket, deployer, tokenId, randomUser
          beforeEach(async () => {
              const accounts = await ethers.getSigners()
              deployer = accounts[0]
              await deployments.fixture(["nftmarket"])
              nftMarket = await ethers.getContract("NFTMarket")
              randomUser = accounts[1]
          })

          const createNft = async (tokenUri) => {
              const tx = await nftMarket.mintNFT(tokenUri)
              const txReciept = await tx.wait(1)
              const tokenID = txReciept.events[0].args.tokenId
              return tokenID
          }
          describe("mintNFT", () => {
              let tokenUri
              beforeEach(async () => {
                  tokenUri = "https://some-token.uri"
                  tokenId = await createNft(tokenUri)
              })
              it("Mints an NFT and increments the counter", async () => {
                  assert(nftMarket.getTokenId().toString(), "1")
              })

              it("checks if the minted token has the same uri", async () => {
                  const mintedTokenUri = await nftMarket.tokenURI(tokenId) //from IERC721 metadata. check docs

                  assert.equal(mintedTokenUri, tokenUri)
              })

              it("verifies that owner owns the NFT", async () => {
                  const owner = await nftMarket.ownerOf(tokenId)
                  assert.equal(owner, deployer.address)
              })

              it("checks if the NFT Transfer event has correct args", async () => {
                  const tx = await nftMarket.mintNFT(tokenUri)
                  const txReciept = await tx.wait(1)
                  const args = txReciept.events[1].args
                  assert.equal(args.tokenId.toString(), 1)
                  assert.equal(args.from, ethers.constants.AddressZero)

                  assert.equal(args.to, deployer.address)
                  assert.equal(args.tokenUri, tokenUri)
                  assert.equal(args.price, 0)
              })
          })

          describe("listNFT", () => {
              const tokenUri = "listing"
              beforeEach(async () => {
                  tokenId = await createNft(tokenUri)
              })
              it("reverts if price is less than or equal to zero", async () => {
                  const price = 0

                  await expect(
                      nftMarket.listNFT(tokenId, price)
                  ).to.be.revertedWith("NFTMarket__InvalidPrice")
              })

              it("reverts if not called by the owner of NFT", async () => {
                  const price = 2
                  const tx = nftMarket
                      .connect(randomUser)
                      .listNFT(tokenId, price)
                  await expect(tx).to.be.revertedWith(
                      "ERC721: approve caller is not token owner or approved for all"
                  )
              })

              it("lists an NFT if all the requirements are met and marketplace should be the owner", async () => {
                  const transaction = await nftMarket.listNFT(tokenId, 2)
                  const txReciept = await transaction.wait(1)

                  //transfer ownership
                  const ownerAddress = await nftMarket.ownerOf(tokenId)
                  assert.equal(ownerAddress, nftMarket.address)
                  //   console.log(txReciept)
                  const args = txReciept.events[2].args
                  assert.equal(args.tokenId.toString(), tokenId.toString())
                  assert.equal(args.from, deployer.address)

                  assert.equal(args.to, nftMarket.address)

                  assert.equal(args.tokenUri, tokenUri)
                  assert.equal(args.price, 2)
              })
          })

          describe("buyNFT", () => {
              let tokenId, tokenUri
              beforeEach(async () => {
                  tokenUri = "buying"
                  tokenId = await createNft(tokenUri)
              })
              it("reverts if NFT is not listed", async () => {
                  await expect(nftMarket.buyNFT(tokenId)).to.be.revertedWith(
                      "NFTMarket__NFTnotListed"
                  )
              })
              it("reverts if the value sent is not equal to listedItem price", async () => {
                  const listTx = await nftMarket.listNFT(tokenId, 3)
                  listTx.wait(1)
                  await expect(
                      nftMarket.buyNFT(tokenId, { value: 4 })
                  ).to.be.revertedWith("NFT Market: Incorrect price")
              })

              it("should transfer ownership to the buyer and send the proceeds to the seller", async () => {
                  const price = 69
                  const sellerProfit = Math.floor(price * 0.95)
                  const fee = price - sellerProfit
                  const initialContractBalance =
                      await nftMarket.provider.getBalance(nftMarket.address)
                  //   console.log(initialContractBalance.toString())
                  const listTx = await nftMarket.listNFT(tokenId, price)
                  await listTx.wait()
                  await new Promise((r) => setTimeout(r, 100)) //takes gas fees into account and shows the balance
                  const oldDeployerBalance = await deployer.getBalance()
                  //   console.log(oldDeployerBalance.toString())
                  const userConnectedMarketplace = await nftMarket.connect(
                      randomUser
                  )
                  const buyTx = await userConnectedMarketplace.buyNFT(tokenId, {
                      value: price,
                  })
                  const buyTxReciept = await buyTx.wait(1)
                  await new Promise((r) => setTimeout(r, 100))
                  //95% proceeds goes to the seller.
                  const newDeployerBalance = await deployer.getBalance()
                  //   console.log(newDeployerBalance.toString())

                  const difference = newDeployerBalance.sub(oldDeployerBalance)
                  assert.equal(difference, sellerProfit)

                  //5% proceeds to the marketplace
                  const finalContractBalance =
                      await nftMarket.provider.getBalance(nftMarket.address)
                  //   console.log(finalContractBalance.toString())
                  const finalBalance = finalContractBalance.sub(
                      initialContractBalance
                  )

                  assert.equal(finalBalance, fee)

                  //transfer the ownership
                  const owner = await nftMarket.ownerOf(tokenId) //ownerOf determines the current owner
                  assert.equal(owner, randomUser.address)

                  //check if the NFTTransfer event has correct parameters
                  const args = buyTxReciept.events[1].args
                  assert.equal(args.tokenId.toString(), tokenId.toString())
                  assert.equal(args.from, nftMarket.address)
                  assert.equal(args.to, randomUser.address)
                  assert.equal(args.tokenUri, tokenUri)
                  assert.equal(args.price, 0)
              })
          })

          describe("cancelListing", () => {
              let tokenId, tokenUri
              beforeEach(async () => {
                  tokenUri = "random-uri"
                  tokenId = await createNft(tokenUri)
              })

              it("checks if NFT is listed", async () => {
                  await expect(
                      nftMarket.cancelListing(tokenId)
                  ).to.be.revertedWith("NFTMarket__NFTnotListed")
              })

              it("verifies the owner of the NFT", async () => {
                  await nftMarket.listNFT(tokenId, 3)
                  await expect(
                      nftMarket.connect(randomUser).cancelListing(tokenId)
                  ).to.be.revertedWith("NFTMarket__NotOwner")
              })

              it("verifies if the ownership is transferred", async () => {
                  await nftMarket.listNFT(tokenId, 3)
                  await nftMarket.cancelListing(tokenId)
                  const ownerAddress = await nftMarket.ownerOf(tokenId)
                  assert.equal(ownerAddress, deployer.address)
              })

              it("verifies if NFT Transfer event is emitted", async () => {
                  await nftMarket.listNFT(tokenId, 3)
                  const cancelTx = await nftMarket.cancelListing(tokenId)
                  const cancelTxReciept = await cancelTx.wait(1)
                  const args = cancelTxReciept.events[1].args
                  assert.equal(args.tokenId.toString(), tokenId.toString())
                  assert.equal(args.from, nftMarket.address)

                  assert.equal(args.to, deployer.address)
                  assert.equal(args.tokenUri, tokenUri)
                  assert.equal(args.price, 0)
              })
          })

          describe("withdrawFunds", () => {
              it("reverts if not called by owner", async () => {
                  const tx = nftMarket.connect(randomUser).withdrawFunds()
                  await expect(tx).to.be.revertedWith(
                      "Ownable: caller is not the owner"
                  )
              })

              it("withdraws the amount and gives it to deployer", async () => {
                  const price = 69
                  const tokenId = await createNft("some-random")
                  //   console.log(`Token ID: ${tokenId}`)
                  await nftMarket.listNFT(tokenId, price)
                  const buyTx = await nftMarket.buyNFT(tokenId, {
                      value: price,
                  })
                  await buyTx.wait(1)
                  const contractBalance = await nftMarket.provider.getBalance(
                      nftMarket.address
                  )

                  const initialDeployerBalance = await deployer.getBalance()
                  //   console.log(
                  //       `Initial Deployer Balance: ${initialDeployerBalance}`
                  //    )

                  const tx = await nftMarket.withdrawFunds()
                  const reciept = await tx.wait(1)
                  //   await new Promise((r) => setTimeout(r, 100))
                  const finalDeployerBalance = await deployer.getBalance()
                  const totalGasPrice = reciept.gasUsed.mul(
                      reciept.effectiveGasPrice
                  )
                  //   console.log(`Final Deployer Balance: ${finalDeployerBalance}`)
                  const diff = finalDeployerBalance
                      .add(totalGasPrice)
                      .sub(initialDeployerBalance)
                  assert.equal(diff.toString(), contractBalance.toString())
              })

              it("revert if the contract balance is zero", async () => {
                  await expect(nftMarket.withdrawFunds()).to.be.revertedWith(
                      "NFTMarket__ZeroBalance"
                  )
              })
          })
      })
