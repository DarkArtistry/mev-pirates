const ethers = require('ethers')
const QuoterABI = require('@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json');
const provider = new ethers.JsonRpcProvider('http://160.202.131.49:8545');
// Contract addresses
const QUOTER_CONTRACT_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QuoterABI.abi, provider);
const { uniswapCustomDecoder } = require('./uniswapDecoder')

// Minimal ABI for ERC-20 token decimals
const ERC20_ABI = [
    {
      "constant": true,
      "inputs": [],
      "name": "decimals",
      "outputs": [{"name": "", "type": "uint8"}],
      "type": "function"
    },
    // Optional: You might also want name and symbol
    {
      "constant": true,
      "inputs": [],
      "name": "name",
      "outputs": [{"name": "", "type": "string"}],
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "symbol",
      "outputs": [{"name": "", "type": "string"}],
      "type": "function"
    }
];
  
// Example function to get token decimals
async function getTokenDecimals(tokenAddress, provider) {
try {
    // Create contract instance
    const tokenContract = new ethers.Contract(
    tokenAddress,
    ERC20_ABI,
    provider
    );
    
    // Call the decimals function
    const decimals = await tokenContract.decimals();
    
    // Optionally get name and symbol for better identification
    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();
    
    return {
    address: tokenAddress,
    name,
    symbol,
    decimals: Number(decimals) // Convert from BigNumber if needed
    };
} catch (error) {
    console.error(`Error getting decimals for token ${tokenAddress}:`, error);
    throw error;
}
}

// USDC has 6 decimals
// const amountIn = ethers.parseUnits('1000', 6); // 1000 USDC

/*
========
getSingleQuote
========
Note the various types of quotes:
1) quoteExactInputSingle - given the amount you want to swap, produces a quote for the amount out for a swap of a single pool
2) quoteExactInput - given the amount you want to swap, produces a quote for the amount out for a swap over multiple pools
3) quoteExactOutputSingle - given the amount you want to get out, produces a quote for the amount in for a swap over a single pool
4) quoteExactOutput - given the amount you want to get out, produces a quote for the amount in for a swap over multiple pools
*/
async function getSingleQuote(tokenInAddress, tokenOutAddress, fee=3000, amountIn) {
    try {
      let tokenInDetails = await getTokenDecimals(tokenInAddress, provider)
      console.log("tokenInDetails : ", tokenInDetails);
      
      // Check if provider is connected
      const blockNumber = await provider.getBlockNumber();
      console.log('Connected to network at block:', blockNumber);
  
      const amountInEther = ethers.parseUnits(`${amountIn}`, tokenInDetails.decimals);
      console.log("amountIn : ", amountIn);
      
      // Create the params struct as expected by the contract
      const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInEther,
        fee: fee,
        sqrtPriceLimitX96: 0  // No price limit
      };
      
      // Call with struct parameter and destructure the return values
      const [quotedAmountOut, , , ] = await quoterContract.quoteExactInputSingle.staticCall(params);
      
      let tokenOutDetails = await getTokenDecimals(tokenOutAddress, provider)
      console.log("tokenOutDetails : ", tokenOutDetails);
      const formattedOutput = ethers.formatUnits(quotedAmountOut, tokenOutDetails.decimals);
      console.log('Quoted amount out:', formattedOutput, tokenOutDetails.symbol);
      
      // Calculate exchange rate
      const rate = Number(formattedOutput) / amountIn;
      console.log(`Exchange rate: 1 ${tokenInDetails.symbol} = ${rate} ${tokenOutDetails.symbol}`);
      
      return {
          blockNumber: blockNumber,
          amountIn: `${amountIn} ${tokenInDetails.symbol}`,
          amountOut: `${formattedOutput} ${tokenOutDetails.symbol}`,
          rate: rate
      };
    } catch (error) {
      console.error('Error getting quote:');
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      
      // Add more detailed error information
      if (error.reason) console.error('Error reason:', error.reason);
      if (error.data) console.error('Error data:', error.data);
      if (error.transaction) console.error('Error transaction:', error.transaction);
      
      console.log(`Failed to get quote for ${tokenInAddress} to ${tokenOutAddress} with fee ${fee}`);
      
      // Return empty object instead of throwing
      return {};
    }
}
// // Execute and handle promise
// Token addresses
const exampleTokenIn = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
const exampleTokenOut = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
const exampleFee = 3000; // 0.3% fee tier

getSingleQuote(exampleTokenIn, exampleTokenOut, 3000, 1000)
  .then(result => console.log('SingleQuote retrieved successfully:', result))
  .catch(error => console.error('Failed to get quote:', error.message));

async function getMultiQuote(tokenInAddress, tokenOutAddress, fee = 3000, amountInWei) {
    // Common fee tiers used by Uniswap V3
    const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
    
    // If the specified fee is not in our standard tiers, add it to the beginning of the array
    if (!feeTiers.includes(fee)) {
        feeTiers.unshift(fee);
    }
    
    // Keep track of all errors for detailed reporting if all attempts fail
    const errors = [];
    
    // Try each fee tier
    for (const currentFee of feeTiers) {
        try {
            // Get token details
            let tokenInDetails = await getTokenDecimals(tokenInAddress, provider);
            console.log(`Attempting quote with fee tier: ${currentFee / 10000}%`);
            console.log("tokenInDetails:", tokenInDetails);
            
            // Check if provider is connected
            const blockNumber = await provider.getBlockNumber();
            console.log('Connected to network at block:', blockNumber);

            // Convert to BigInt to ensure proper handling
            const amountIn = BigInt(amountInWei.toString());
            
            // Format for readable output
            const amountInHuman = ethers.formatUnits(amountIn, tokenInDetails.decimals);
            console.log(`Amount in human-readable: ${amountInHuman} ${tokenInDetails.symbol}`);

            // Encode the path
            const path = ethers.solidityPacked(
                ['address', 'uint24', 'address'],
                [tokenInAddress, currentFee, tokenOutAddress]
            );
            
            console.log("Path encoded:", path);

            // Call the quoter
            console.log(`Calling quoter contract with fee tier: ${currentFee / 10000}%`);
            const [quotedAmountOut, , , ] = await quoterContract.quoteExactInput.staticCall(
                path,
                amountIn
            );

            // If we get here, the quote succeeded!
            console.log(`Quote succeeded with fee tier: ${currentFee / 10000}%`);

            // Get output token details
            let tokenOutDetails = await getTokenDecimals(tokenOutAddress, provider);
            console.log("tokenOutDetails:", tokenOutDetails);
            
            // Format the output for display
            const amountOutHuman = ethers.formatUnits(quotedAmountOut, tokenOutDetails.decimals);
            console.log('Quoted amount out:', amountOutHuman, tokenOutDetails.symbol);
            
            // Calculate exchange rate (using human-readable amounts)
            const rate = Number(amountOutHuman) / Number(amountInHuman);
            console.log(`Exchange rate: 1 ${tokenInDetails.symbol} = ${rate} ${tokenOutDetails.symbol}`);
            
            // Return successful result with the fee tier that worked
            return {
                blockNumber,
                amountInWei: amountIn.toString(),
                amountInHuman: amountInHuman,
                amountOutWei: quotedAmountOut.toString(),
                amountOutHuman: amountOutHuman,
                rate,
                usedFeeTier: currentFee,
                tokenIn: {
                    address: tokenInAddress,
                    symbol: tokenInDetails.symbol,
                    decimals: tokenInDetails.decimals
                },
                tokenOut: {
                    address: tokenOutAddress,
                    symbol: tokenOutDetails.symbol,
                    decimals: tokenOutDetails.decimals
                }
            };
        } catch (error) {
            console.error(`Error getting quote with fee tier ${currentFee / 10000}%:`);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            
            // Store error for this fee tier
            errors.push({
                feeTier: currentFee,
                code: error.code,
                message: error.message
            });
            
            // Continue to the next fee tier
            continue;
        }
    }
    
    // If we get here, all fee tiers failed
    console.error('All fee tiers failed for quote:');
    console.error('Attempted fee tiers:', feeTiers.map(f => `${f / 10000}%`).join(', '));
    console.error('Error summary:', errors);
    
    // Log possible reasons
    console.log('Possible reasons for failure:');
    console.log('1. Pool might not exist for this token pair with any fee tier');
    console.log('2. Insufficient liquidity in all pools');
    console.log('3. The amount might be too large for the available liquidity');
    console.log('4. One of the tokens might have transfer restrictions');
    console.log(`Failed to get quote for ${tokenInAddress} to ${tokenOutAddress}`);
    
    // Return empty object
    return {};
}
  
//   // Execute and handle promise
// For USDC (6 decimals), 1000 USDC in wei is:
getMultiQuote(exampleTokenIn, exampleTokenOut, 3000, "1000000000") // 1000 * 10^6
  .then(result => console.log('MultiQuote retrieved successfully:', result))
  .catch(error => console.error('Failed to get quote:', error.message));

/*
    ===========================
    getV2Slippage
    ===========================
    getV2Slippage gets the rawDecoded Value of the swap transaction, queries the MultiQuote, makes a comparison to findout the slippage.
    Sample uniswap V2 transaction:
    ```
    {
    "fragment":{
        "type":"function",
        "inputs":[
            {
                "name":"amountIn",
                "type":"uint256",
                "baseType":"uint256",
                "components":null,
                "arrayLength":null,
                "arrayChildren":null
            },
            {
                "name":"amountOutMin",
                "type":"uint256",
                "baseType":"uint256",
                "components":null,
                "arrayLength":null,
                "arrayChildren":null
            },
            {
                "name":"path",
                "type":"address[]",
                "baseType":"array",
                "components":null,
                "arrayLength":-1,
                "arrayChildren":{
                "name":"",
                "type":"address",
                "baseType":"address",
                "components":null,
                "arrayLength":null,
                "arrayChildren":null
                }
            },
            {
                "name":"to",
                "type":"address",
                "baseType":"address",
                "components":null,
                "arrayLength":null,
                "arrayChildren":null
            },
            {
                "name":"deadline",
                "type":"uint256",
                "baseType":"uint256",
                "components":null,
                "arrayLength":null,
                "arrayChildren":null
            }
        ],
        "name":"swapExactTokensForTokens",
        "constant":false,
        "outputs":[
            {
                "name":"amounts",
                "type":"uint256[]",
                "baseType":"array",
                "components":null,
                "arrayLength":-1,
                "arrayChildren":{
                "name":"",
                "type":"uint256",
                "baseType":"uint256",
                "components":null,
                "arrayLength":null,
                "arrayChildren":null
                }
            }
        ],
        "stateMutability":"nonpayable",
        "payable":false,
        "gas":null
    },
    "name":"swapExactTokensForTokens",
    "args":[
        "353968878495180686",
        "129859202202142246998163304",
        [
            "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
            "0xc00e94Cb662C3520282E6f5717214004A7f26888",
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "0x41933422DC4a1cb8C822e06f12f7b52fA5E7E094"
        ],
        "0xFffa0BCBA1aE671b50e0ad9d8320Fbc762c6A67B",
        "1617981580"
    ],
    "signature":"swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    "selector":"0x38ed1739",
    "value":"0"
    }
    ```
*/
async function getV2Slippage(v2RawDecoded) {
    // v2RawDecoded.fragment.inputs = amountIn|uint256, amountOutMin|uint256, path|address[], to|address, deadline | uint256
    // v2RawDecoded.fragment.outputs = amounts | unit256[]
    let tradingPath = []
    let amountOutMin = 0n; // Use BigInt literal
    
    switch (v2RawDecoded.name) {
        case "swapExactTokensForTokens":
            tradingPath = v2RawDecoded.args[2]
            break;
    
        default:
            break;
    }

    let quote = tradingPath.length > 0 ? 
        await getMultiQuote(tradingPath[0], tradingPath[tradingPath.length - 1], 3000, v2RawDecoded.args[0]) 
        : {};
        
    let slippageAbsolute = 0n; // Use BigInt literal
    let slippagePercentage = 0;
    
    switch (v2RawDecoded.name) {
        case "swapExactTokensForTokens":
            // Ensure we're working with BigInt
            if (v2RawDecoded.args[1]) {
                amountOutMin = BigInt(v2RawDecoded.args[1].toString());
            }
            break;
        default:
            break;
    }
    
    // Safely convert to BigInt, using 0n if undefined
    const expectedAmount = quote.amountOutWei ? BigInt(quote.amountOutWei) : 0n;
    
    // Now both values are BigInt, so the math is safe
    if (expectedAmount > 0n && amountOutMin > 0n) {
        slippageAbsolute = amountOutMin < expectedAmount ? expectedAmount - amountOutMin : 0n;
        
        // Convert to number only for percentage calculation
        if (slippageAbsolute > 0n && expectedAmount > 0n) {
            // Use Number() to convert from BigInt to number for the percentage calculation
            slippagePercentage = Number((slippageAbsolute * 10000n) / expectedAmount) / 100;
        }
    }
    
    return {
        quote,
        blockNumber: quote.blockNumber,
        tokenOutSymbol: quote.tokenOut && quote.tokenOut.symbol,
        slippageAbsolute: slippageAbsolute.toString(), // Convert to string for JSON
        slippagePercentage
    }
}

async function getV3Slippage(v3RawDecoded) {
    // v3RawDecoded.fragment.inputs.components = tokenIn|address, tokenOut|address, fee|uint24, recipient|address, deadline|uint256, amountIn|uint256, amountOutMinimum|uint256, sqrtPriceLimitX96|uint160 (price limit for swap 0 for no limits)
    // v3RawDecoded.name = exactInputSingle
    // v3RawDecoded.args = []...
    let tradingPath = []
    let amountOutMin = 0n; // Changed to BigInt literal
    
    switch (v3RawDecoded.name) {
        case "exactInputSingle":
            tradingPath[0] = v3RawDecoded.args[0][0]
            tradingPath[1] = v3RawDecoded.args[0][1]
            break;
    
        default:
            break;
    }

    // TODO: Check the quote for single pairs instead to be most reliable. you probably need to know how to check the pools for V2.
    let quote = tradingPath.length > 0 ? await getMultiQuote(tradingPath[0], tradingPath[tradingPath.length - 1], 3000, v3RawDecoded.args[0][5]) : {}
    
    let slippageAbsolute = 0n; // Changed to BigInt literal
    let slippagePercentage = 0;
    
    switch (v3RawDecoded.name) {
        case "swapExactTokensForTokens":
            // Ensure we're working with BigInt
            if (v3RawDecoded.args[7]) {
                amountOutMin = BigInt(v3RawDecoded.args[7].toString())
            }
            break;
        default:
            break;
    }
    
    const expectedAmount = quote.amountOutWei ? BigInt(quote.amountOutWei) : 0n; // Changed to BigInt literal
    
    // Use BigInt comparisons and operations
    if (amountOutMin > expectedAmount && expectedAmount > 0n) {
        slippageAbsolute = amountOutMin - expectedAmount;
        slippagePercentage = Number((slippageAbsolute * 10000n) / expectedAmount) / 100; // Using 10000n BigInt literal
    }
    
    return {
        quote,
        blockNumber: quote.blockNumber,
        tokenOutSymbol: quote.tokenOut && quote.tokenOut.symbol,
        slippageAbsolute: slippageAbsolute.toString(), // Convert to string for JSON serialization
        slippagePercentage
    }
}


async function getV4Slippage(v4RawDecoded) {
    // Define ABI structures for decoding
    const poolKeyAbi = [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' }
    ];
    
    const exactInputSingleParamsAbi = [
        { name: 'poolKey', type: 'tuple', components: poolKeyAbi },
        { name: 'zeroForOne', type: 'bool' },
        { name: 'amountIn', type: 'uint128' },
        { name: 'amountOutMinimum', type: 'uint128' },
        { name: 'hookData', type: 'bytes' }
    ];
    // Commands
    const V3_SWAP_EXACT_IN = 0x00;
    const V3_SWAP_EXACT_OUT = 0x01;
    const V2_SWAP_EXACT_IN = 0x08;
    const V2_SWAP_EXACT_OUT = 0x09;
    const PERMIT2_PERMIT = 0x0a;
    const WRAP_ETH = 0x0b;
    const UNWRAP_WETH = 0x0c;
    const V4_SWAP = 0x10;
    // Extract commands and inputs from the execute function
    const commandsBytes = ethers.getBytes(v4RawDecoded.args[0]); // e.g., "0x10000604"
    const inputs = v4RawDecoded.args[1];  // Array of inputs
  
    // Loop through commands to find V4_SWAP (0x10)
    let swapIndex = -1;
    for (let i = 0; i < commandsBytes.length; i++) {
      const commandType = commandsBytes[i] & 0x3f; // Mask to get command type
      if (commandType === 0x10) { // V4_SWAP
        swapIndex = i;
        break; // For simplicity, use the first V4_SWAP
      }
    }
  
    if (swapIndex === -1) {
      console.error("No V4_SWAP command found in the transaction");
      return {}
    }
  
    // Decode the input for the V4_SWAP command
    const input = inputs[swapIndex];
    let universalRouterAbi = [{"inputs":[{"components":[{"internalType":"address","name":"permit2","type":"address"},{"internalType":"address","name":"weth9","type":"address"},{"internalType":"address","name":"v2Factory","type":"address"},{"internalType":"address","name":"v3Factory","type":"address"},{"internalType":"bytes32","name":"pairInitCodeHash","type":"bytes32"},{"internalType":"bytes32","name":"poolInitCodeHash","type":"bytes32"},{"internalType":"address","name":"v4PoolManager","type":"address"},{"internalType":"address","name":"v3NFTPositionManager","type":"address"},{"internalType":"address","name":"v4PositionManager","type":"address"}],"internalType":"struct RouterParameters","name":"params","type":"tuple"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"BalanceTooLow","type":"error"},{"inputs":[],"name":"ContractLocked","type":"error"},{"inputs":[{"internalType":"Currency","name":"currency","type":"address"}],"name":"DeltaNotNegative","type":"error"},{"inputs":[{"internalType":"Currency","name":"currency","type":"address"}],"name":"DeltaNotPositive","type":"error"},{"inputs":[],"name":"ETHNotAccepted","type":"error"},{"inputs":[{"internalType":"uint256","name":"commandIndex","type":"uint256"},{"internalType":"bytes","name":"message","type":"bytes"}],"name":"ExecutionFailed","type":"error"},{"inputs":[],"name":"FromAddressIsNotOwner","type":"error"},{"inputs":[],"name":"InputLengthMismatch","type":"error"},{"inputs":[],"name":"InsufficientBalance","type":"error"},{"inputs":[],"name":"InsufficientETH","type":"error"},{"inputs":[],"name":"InsufficientToken","type":"error"},{"inputs":[{"internalType":"bytes4","name":"action","type":"bytes4"}],"name":"InvalidAction","type":"error"},{"inputs":[],"name":"InvalidBips","type":"error"},{"inputs":[{"internalType":"uint256","name":"commandType","type":"uint256"}],"name":"InvalidCommandType","type":"error"},{"inputs":[],"name":"InvalidEthSender","type":"error"},{"inputs":[],"name":"InvalidPath","type":"error"},{"inputs":[],"name":"InvalidReserves","type":"error"},{"inputs":[],"name":"LengthMismatch","type":"error"},{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"NotAuthorizedForToken","type":"error"},{"inputs":[],"name":"NotPoolManager","type":"error"},{"inputs":[],"name":"OnlyMintAllowed","type":"error"},{"inputs":[],"name":"SliceOutOfBounds","type":"error"},{"inputs":[],"name":"TransactionDeadlinePassed","type":"error"},{"inputs":[],"name":"UnsafeCast","type":"error"},{"inputs":[{"internalType":"uint256","name":"action","type":"uint256"}],"name":"UnsupportedAction","type":"error"},{"inputs":[],"name":"V2InvalidPath","type":"error"},{"inputs":[],"name":"V2TooLittleReceived","type":"error"},{"inputs":[],"name":"V2TooMuchRequested","type":"error"},{"inputs":[],"name":"V3InvalidAmountOut","type":"error"},{"inputs":[],"name":"V3InvalidCaller","type":"error"},{"inputs":[],"name":"V3InvalidSwap","type":"error"},{"inputs":[],"name":"V3TooLittleReceived","type":"error"},{"inputs":[],"name":"V3TooMuchRequested","type":"error"},{"inputs":[{"internalType":"uint256","name":"minAmountOutReceived","type":"uint256"},{"internalType":"uint256","name":"amountReceived","type":"uint256"}],"name":"V4TooLittleReceived","type":"error"},{"inputs":[{"internalType":"uint256","name":"maxAmountInRequested","type":"uint256"},{"internalType":"uint256","name":"amountRequested","type":"uint256"}],"name":"V4TooMuchRequested","type":"error"},{"inputs":[],"name":"V3_POSITION_MANAGER","outputs":[{"internalType":"contract INonfungiblePositionManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"V4_POSITION_MANAGER","outputs":[{"internalType":"contract IPositionManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"commands","type":"bytes"},{"internalType":"bytes[]","name":"inputs","type":"bytes[]"}],"name":"execute","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"bytes","name":"commands","type":"bytes"},{"internalType":"bytes[]","name":"inputs","type":"bytes[]"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"execute","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"msgSender","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"poolManager","outputs":[{"internalType":"contract IPoolManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"int256","name":"amount0Delta","type":"int256"},{"internalType":"int256","name":"amount1Delta","type":"int256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"uniswapV3SwapCallback","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes","name":"data","type":"bytes"}],"name":"unlockCallback","outputs":[{"internalType":"bytes","name":"","type":"bytes"}],"stateMutability":"nonpayable","type":"function"},{"stateMutability":"payable","type":"receive"}]
    const decodedSwap = uniswapCustomDecoder(universalRouterAbi, input);
    if (!decodedSwap) {
        console.log("EMPTY universalRouterAbi DECODED!");
        return {
            quote: {},
            slippageAbsolute: 0,
            slippagePercentage: 0,
        }
    }
    console.log("decodedSwap : ", decodedSwap);
    const swapParamsEncoded = decodedSwap[0]; // First param is ExactInputSingleParams
    const decodedSwapParams = uniswapCustomDecoder(exactInputSingleParamsAbi, swapParamsEncoded);
  
    // Extract swap details
    const poolKey = decodedSwapParams[0];
    const zeroForOne = decodedSwapParams[1];
    const amountIn = decodedSwapParams[2].toString();
    const amountOutMinimum = decodedSwapParams[3].toString();
  
    const currency0 = poolKey[0]; // Token0 address
    const currency1 = poolKey[1]; // Token1 address
    const fee = poolKey[2].toString(); // Fee for the pool
  
    // Determine tokenIn and tokenOut based on swap direction
    const tokenIn = zeroForOne ? currency0 : currency1;
    const tokenOut = zeroForOne ? currency1 : currency0;
  
    // Get the expected output from a quote function
    const quote = await getMultiQuote(tokenIn, tokenOut, fee, amountIn);
    const expectedAmount = quote.amountOutWei ? BigInt(quote.amountOutWei) : 0n;
    const amountOutMinBigInt = BigInt(amountOutMinimum);
  
    // Calculate slippage
    let slippageAbsolute = 0n;
    let slippagePercentage = 0;
  
    if (expectedAmount > amountOutMinBigInt) {
      slippageAbsolute = expectedAmount - amountOutMinBigInt;
      if (expectedAmount > 0n) {
        slippagePercentage = Number((slippageAbsolute * 10000n) / expectedAmount) / 100; // % with 2 decimals
      }
    }
  
    return {
      quote,                  // Quote details
      blockNumber: quote.blockNumber,
      tokenOutSymbol: quote.tokenOut && quote.tokenOut.symbol,
      slippageAbsolute: slippageAbsolute.toString(), // Absolute slippage as string
      slippagePercentage      // Percentage slippage
    };
  }
  

module.exports = {
    getSingleQuote,
    getMultiQuote,
    getV2Slippage,
    getV3Slippage,
    getV4Slippage
}