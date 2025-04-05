const { getMultiQuote } = require('./uniswapAbitrager')

async function getV6Slippage(v6RawDecoded) {
    // v3RawDecoded.fragment.inputs = executor|address, 
    // desc.components|turple(srcToken|address, dstToken|address, srcReceiver|address, dstReceiver|address, amount|uint256, minReturnAmount|uint256, flags|uint256), 
    // data|bytes
    
    // v3RawDecoded.name = swap
    // v3RawDecoded.args = [executor [desc.components], data]...
    try {
        console.log("Processing 1Inch V6 swap");
        
        if (!v6RawDecoded || !v6RawDecoded.name || v6RawDecoded.name !== "swap" || !v6RawDecoded.args) {
            console.log("Invalid v6RawDecoded or not a swap:", v6RawDecoded?.name);
            return {
                error: "Invalid transaction data or not a swap"
            };
        }
        
        // Extract trading path and amounts from desc tuple
        const desc = v6RawDecoded.args[1];
        
        if (!desc || !Array.isArray(desc) || desc.length < 6) {
            console.log("Invalid desc tuple:", desc?.length);
            return {
                error: "Invalid desc tuple"
            };
        }
        
        const srcToken = desc[0];  // srcToken
        const dstToken = desc[1];  // dstToken
        const amount = desc[4];    // amount
        const minReturnAmount = desc[5]; // minReturnAmount
        
        console.log("Trading path:", srcToken, "->", dstToken);
        console.log("Amount:", amount.toString());
        console.log("Min return amount:", minReturnAmount.toString());
        
        // Handle ETH as a special case
        const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        
        // If source token is ETH, use WETH for the quote
        const tokenIn = srcToken.toLowerCase() === ETH_ADDRESS.toLowerCase() ? WETH_ADDRESS : srcToken;
        const tokenOut = dstToken.toLowerCase() === ETH_ADDRESS.toLowerCase() ? WETH_ADDRESS : dstToken;
        
        // Use the getMultiQuote function which already has fee tier retry logic
        const quote = await getMultiQuote(tokenIn, tokenOut, 3000, amount.toString());
        
        if (!quote || Object.keys(quote).length === 0) {
            console.log("FAILED TO GET QUOTE IN ONEINCH !");
            return {
                error: "Failed to get quote for trade",
                tokenIn,
                tokenOut,
                amount: amount.toString()
            };
        }
        
        // Calculate slippage
        const expectedAmount = BigInt(quote.amountOutWei);
        const amountOutMin = BigInt(minReturnAmount.toString());
        
        let slippageAbsolute = 0n;
        let slippagePercentage = 0;
        
        if (expectedAmount > 0n && amountOutMin > 0n) {
            // Slippage is the percentage difference between expected and minimum
            if (amountOutMin < expectedAmount) {
                slippageAbsolute = expectedAmount - amountOutMin;
                slippagePercentage = Number((slippageAbsolute * 10000n) / expectedAmount) / 100;
            } else {
                // If minimum exceeds expected, there's no slippage
                slippageAbsolute = 0n;
                slippagePercentage = 0;
            }
        }
        
        return {
            quote,
            tokenOutSymbol: quote.tokenOut && quote.tokenOut.symbol,
            blockNumber: quote.blockNumber,
            tokenIn,
            tokenOut,
            amount: amount.toString(),
            minReturnAmount: minReturnAmount.toString(),
            expectedAmount: expectedAmount.toString(),
            slippageAbsolute: slippageAbsolute.toString(),
            slippagePercentage
        };
    } catch (error) {
        console.error("Error in getV6Slippage:", error);
        return {
            error: "Error processing swap",
            message: error.message,
            stack: error.stack
        };
    }
}

module.exports = {
    getV6Slippage,
}