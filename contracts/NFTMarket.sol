//SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

error NFTMarket__InvalidPrice();
error NFTMarket__NFTnotListed();
error NFTMarket__NotOwner();
error NFTMarket__ZeroBalance();

contract NFTMarket is ERC721URIStorage, Ownable {
    //Anybody can assign a random value to the _tokenCounter variable. So use Counters from openzeppelin.
    using SafeMath for uint256;
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    /**
     * Events - useful for the frontend of the app.
     */
    //if tokenUri is not an empty string => NFT created
    //if price is >= 0 => NFT listed
    //if price is 0 && tokenUri is an empty string => NFT Transferred (either bought or cancelled listing)
    //this event need a from address to index it according to graph protocol
    event NftTransfer(
        uint256 tokenId,
        address from,
        address to,
        string tokenUri,
        uint256 price
    );

    struct Listing {
        uint256 price;
        address seller;
    }

    mapping(uint256 => Listing) private s_listings;

    modifier isListed(uint256 tokenId) {
        Listing memory listing = s_listings[tokenId];
        if (listing.price <= 0) {
            revert NFTMarket__NFTnotListed();
        }
        _;
    }

    modifier isOwner(uint256 tokenId) {
        Listing memory listing = s_listings[tokenId];
        if (listing.seller != msg.sender) {
            revert NFTMarket__NotOwner();
        }
        _;
    }

    constructor() ERC721("NFT Market", "NFTM") {}

    function mintNFT(string memory tokenURI) public {
        address zeroAddress = address(0);
        uint256 currentTokenId = _tokenIds.current();
        _safeMint(msg.sender, currentTokenId);
        _setTokenURI(currentTokenId, tokenURI);
        _tokenIds.increment();

        emit NftTransfer(currentTokenId, zeroAddress, msg.sender, tokenURI, 0);
    }

    /**
     * List an NFT
     * @param tokenId gives a unique tokenId for an NFT
     * @param price price of the NFT
     */
    function listNFT(uint256 tokenId, uint256 price) public {
        if (price <= 0) {
            revert NFTMarket__InvalidPrice();
        }
        //In order to transfer ownership from seller to marketplace we need to approve the NFT. This also acts like a require statement which needs approval.
        approve(address(this), tokenId);

        //transferring the ownership from seller to marketplace
        transferFrom(msg.sender, address(this), tokenId);

        //Entering it into our mapping
        s_listings[tokenId] = Listing(price, msg.sender);

        emit NftTransfer(
            tokenId,
            msg.sender,
            address(this),
            tokenURI(tokenId),
            price
        );
    }

    /**
     * Buy an NFT
     * 2 Conditions should be met - the NFT should be listed and the amount recieved should be equal to the listing price of the NFT.
     * @param tokenId unique id for the required NFT.
     */

    function buyNFT(uint256 tokenId) public payable isListed(tokenId) {
        Listing memory listedNFT = s_listings[tokenId];

        require(listedNFT.price == msg.value, "NFT Market: Incorrect price");

        //Transferring ownership from market to msg.sender
        ERC721(address(this)).transferFrom(
            /* from */ address(this),
            /*to*/ msg.sender,
            tokenId
        );

        delete s_listings[tokenId];

        //transferring 95% of ETH from sale to seller. 5% to the marketplace.
        payable(listedNFT.seller).transfer(listedNFT.price.mul(95).div(100));

        emit NftTransfer(
            tokenId,
            address(this),
            msg.sender,
            tokenURI(tokenId),
            0
        );
    }

    /**
     * Cancel the listing of an NFT
     * 2 conditions - the NFT should be listed and the owner should be the one who calls this function
     */
    function cancelListing(
        uint256 tokenId
    ) public isListed(tokenId) isOwner(tokenId) {
        delete s_listings[tokenId];
        ERC721(address(this)).transferFrom(address(this), msg.sender, tokenId);

        emit NftTransfer(
            tokenId,
            address(this),
            msg.sender,
            tokenURI(tokenId),
            0
        );
    }

    function withdrawFunds() public onlyOwner {
        uint256 balance = address(this).balance;
        if (balance <= 0) {
            revert NFTMarket__ZeroBalance();
        }

        payable(msg.sender).transfer(balance);
    }

    function getTokenId() public view returns (uint256) {
        return _tokenIds.current();
    }
}
