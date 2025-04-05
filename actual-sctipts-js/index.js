const http = require('http');
const ethers = require('ethers')
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios'); 
const { Client } = require('ssh2');
const tunnelSsh = require('tunnel-ssh');
const { createClient } = require('@clickhouse/client');
const { uniswapV2Decoder, uniswapV3Decoder, uniswapV4Decoder } = require("./uniswapDecoder")
const { oneInchV6Decoder } = require("./oneInchDecoder")
const { getV2Slippage, getV3Slippage, getV4Slippage } = require("./uniswapAbitrager")
const { getV6Slippage } = require("./oneInchAbitrager")

const tunnel = tunnelSsh.createTunnel || tunnelSsh;

// Initialize ClickHouse client
const clickhouse = createClient({
  host: 'http://160.202.131.49:8123', // Change to your ClickHouse server URL
  username: 'default',
  password: 'yourpassword',
  database: 'default',
  // For SSH connections, use these options:
  compression: {
    request: true,
    response: true
  },
  // Keep the connection alive (helpful for long-running processes)
  keepAlive: {
    enabled: true,
    // Interval in milliseconds to send keepalive packets
    interval: 30000
  }
});

// Function to calculate the estimated MEV value
function calculateMEVValue(tx) {
  if (!tx.isSwap || !tx.slippageNumeric) return 0;
  
  try {
    // Basic calculation based on transaction value and slippage
    if (tx.valueInt && tx.valueInt !== '0') {
      const valueInEth = Number(BigInt(tx.valueInt)) / 1e18;
      const slippagePercent = parseFloat(tx.slippageNumeric);
      return valueInEth * (slippagePercent / 100) * 0.5; // 50% capture assumption
    }
    return 0;
  } catch (error) {
    console.error(`Error calculating MEV value: ${error.message}`);
    return 0;
  }
}

// Function to insert a transaction into ClickHouse
async function insertTransactionToClickHouse(tx) {
  try {
    // // Check if transaction already exists
    // const existingTx = await clickhouse.query({
    //   query: 'SELECT hash FROM ethereum_transactions WHERE hash = {hash: String}',
    //   query_params: { hash: tx.hash },
    //   format: 'JSONEachRow'
    // });
    
    // const results = await existingTx.json();
    // if (results.length > 0) {
    //   console.log(`Transaction ${tx.hash} ALREADY exists in database, skipping`);
    //   return false 
    // }

    // console.log(`Transaction ${tx.hash} DOES NOT exists in database, inserting..`);
    // Process slippage data if not already done
    if (tx.isSwap) {
        tx.slippageNumeric = String(tx.slippageAbsolute);
        
        // Categorize
        if (tx.slippagePercentage < 5) tx.slippageCategory = 'VERY_LOW';
        else if (tx.slippagePercentage < 10) tx.slippageCategory = 'LOW';
        else if (tx.slippagePercentage < 20) tx.slippageCategory = 'MEDIUM';
        else if (tx.slippagePercentage < 50) tx.slippageCategory = 'HIGH';
        else tx.slippageCategory = 'VERY_HIGH';
        
        tx.mevPotential = (tx.slippageCategory === 'HIGH' || tx.slippageCategory === 'VERY_HIGH') ? 'YES' : 'NO';
    }
    // tx.quoteBlockNumber = swapInfo.blocknumber
    // tx.rawDecoded = swapInfo.rawDecoded
    // tx.tokenOutSymbol = swapInfo.tokenOutSymbol
    // tx.slippageAbsolute = swapInfo.slippageAbsolute
    // tx.slippagePercentage = swapInfo.slippagePercentage
    // Prepare row for insertion - convert BigInt to strings

    // const row = {
    //   hash: tx.hash,
    //   from_address: tx.from,
    //   to_address: tx.to,
    //   gasPrice: tx.gasPrice || '',
    //   gas: tx.gas || '',
    //   value: tx.value || '',
    //   gasPriceInt: tx.gasPriceInt ? Number(tx.gasPriceInt) : 0, // Convert to Number
    //   gasInt: tx.gasInt ? Number(tx.gasInt) : 0, // Convert to Number
    //   valueInt: 0, // Convert to Number instead of String
    //   nonce: tx.nonce || '',
    //   nonceInt: tx.nonceInt ? Number(tx.nonceInt) : 0,
    //   poolType: tx.poolType || '',
    //   isSwap: tx.isSwap === true ? 1 : 0,
    //   dex: tx.decodedSwap?.dex || '',
    //   method: tx.decodedSwap?.method || '',
    //   slippage: tx.decodedSwap?.slippage || '',
    //   quoteBlockNumber: tx.quoteBlockNumber || 0, // start here
    //   rawDecoded: tx.rawDecoded || '',
    //   tokenOutSymbol: tx.tokenOutSymbol || '',
    //   slippageAbsolute: tx.slippageAbsolute ? parseFloat(tx.slippageAbsolute ) : 0,
    //   slippagePercentage: tx.slippagePercentage || 0,
    //   input: '',
    //   translatedInput: '',
    //   updatedAt: tx.updatedAt || Date.now(),
      
    //   // MEV analysis fields
    //   slippagePercent:  0,
    //   slippageCategory: tx.slippageCategory || 'UNKNOWN',
    //   mevPotential: tx.mevPotential === 'YES' ? 1 : 0,
    //   estimatedMEVValue: 0
    // };
    const row = {
      hash: tx.hash,
      from_address: tx.from_address || tx.from, // Handle both field names
      to_address: tx.to_address || tx.to, // Handle both field names
      gasPrice: tx.gasPrice || '',
      gas: tx.gas || '',
      value: tx.value || '',
      gasPriceInt: tx.gasPriceInt ? Number(tx.gasPriceInt) : 0,
      gasInt: tx.gasInt ? Number(tx.gasInt) : 0,
      valueInt: String(tx.valueInt || '0'), // Keep as String for ClickHouse UInt64
      nonce: tx.nonce || '',
      nonceInt: tx.nonceInt ? Number(tx.nonceInt) : 0,
      poolType: tx.poolType || '',
      quoteBlockNumber: tx.quoteBlockNumber || 0,
      rawDecoded: tx.rawDecoded || '',
      tokenOutSymbol: tx.tokenOutSymbol || '',
      slippageAbsolute: tx.slippageAbsolute ? 
        (tx.slippageAbsolute > 1e20 ? 0 : parseFloat(tx.slippageAbsolute)) : 0, // Handle extreme values
      slippagePercentage: tx.slippagePercentage || 0,
      isSwap: tx.isSwap === true || tx.isSwap === 1 ? 1 : 0,
      dex: tx.dex || tx.decodedSwap?.dex || '',
      method: tx.method || tx.decodedSwap?.method || '',
      slippage: '',
      updatedAt: tx.updatedAt || Date.now(),
      slippageCategory: tx.slippageCategory || 'UNKNOWN',
      mevPotential: tx.mevPotential === 'YES' ? 1 : 0,
      estimatedMEVValue: 0
    };
    if (tx.isSwap) console.log('row : ', row);
    
    // Insert into ClickHouse
    await clickhouse.insert({
      table: 'ethereum_transactions',
      values: [row],
      format: 'JSONEachRow'
    });
    
    return true;
  } catch (error) {
    console.error(`Error inserting transaction to ClickHouse: ${error.message}`);
    return false;
  }
}

/**
 * This function would be used to analyze the transaction pool for MEV opportunities
 * It can be called periodically to report on the current state
 */
function analyzeMEVOpportunities(txPool) {
  try {
    // Filter to only look at swap transactions
    const swapTxs = Object.values(txPool).filter(tx => tx.isSwap);
    
    if (swapTxs.length === 0) {
      console.log('No swap transactions in mempool');
      return;
    }
    
    // Add slippage data to each transaction
    swapTxs.forEach(tx => {
      // Use our improved slippage extraction
      tx.slippageNumeric = extractNumericSlippage(tx);
      
      if (tx.slippageNumeric !== null) {
        if (tx.slippageNumeric < 0.5) tx.slippageCategory = 'VERY_LOW';
        else if (tx.slippageNumeric < 1.0) tx.slippageCategory = 'LOW';
        else if (tx.slippageNumeric < 2.0) tx.slippageCategory = 'MEDIUM';
        else if (tx.slippageNumeric < 5.0) tx.slippageCategory = 'HIGH';
        else tx.slippageCategory = 'VERY_HIGH';
      } else {
        tx.slippageCategory = 'UNKNOWN';
      }
      
      tx.mevPotential = 
        (tx.slippageCategory === 'HIGH' || tx.slippageCategory === 'VERY_HIGH') ? 
        'YES' : 'NO';
    });
    
    // Find high-value MEV opportunities
    const highValueTxs = swapTxs.filter(tx => tx.mevPotential === 'YES');
    
    // Display results
    console.log('\n===== MEV OPPORTUNITY ANALYSIS =====');
    console.log(`Total swap transactions: ${swapTxs.length}`);
    console.log(`High-value MEV opportunities: ${highValueTxs.length}`);
    
    // Group by DEX
    const byDex = {};
    swapTxs.forEach(tx => {
      const dex = tx.decodedSwap?.dex || 'Unknown';
      if (!byDex[dex]) byDex[dex] = [];
      byDex[dex].push(tx);
    });
    
    // Show DEX breakdown
    console.log('\nDEX Activity:');
    for (const dex in byDex) {
      const count = byDex[dex].length;
      const highValueCount = byDex[dex].filter(tx => tx.mevPotential === 'YES').length;
      console.log(`${dex}: ${count} transactions, ${highValueCount} high-value opportunities`);
    }
    
    // Only show detailed opportunities if there are some
    if (highValueTxs.length > 0) {
      console.log('\nTop MEV Opportunities:');
      highValueTxs.slice(0, 3).forEach((tx, index) => {
        console.log(`${index + 1}. Hash: ${tx.hash}`);
        console.log(`   DEX: ${tx.decodedSwap?.dex}, Method: ${tx.decodedSwap?.method}`);
        console.log(`   Slippage: ${tx.slippageNumeric}%, Category: ${tx.slippageCategory}`);
        
        // Display value if available
        let valueDisplay = 'Unknown';
        if (tx.valueInt && tx.valueInt !== '0') {
          try {
            // Format the value in ETH
            valueDisplay = ethers.formatEther(tx.valueInt) + ' ETH';
          } catch (e) {
            valueDisplay = tx.valueInt + ' (raw)';
          }
        }
        console.log(`   Value: ${valueDisplay}`);
      });
    }
    
    console.log('===== END ANALYSIS =====\n');
  } catch (error) {
    console.error(`Error analyzing MEV opportunities: ${error.message}`);
  }
}

/**
 * Calculate slippage from transaction data more accurately
 * @param {Object} tx - Transaction object with decoded swap information
 * @returns {Number|null} - Slippage percentage or null if not determinable
 */
function calculateActualSlippage(tx) {
  if (!tx.decodedSwap || !tx.decodedSwap.decodedData) return null;
  
  const { method, dex, decodedData } = tx.decodedSwap;
  
  
  try {
    // For Uniswap V2-style DEXes (including Sushiswap, Pancakeswap)
    if (dex.includes('UNISWAP_V2') || dex.includes('SUSHISWAP') || dex === 'PANCAKESWAP') {
      // Exact input methods which specify minimum output
      if (method === 'swapExactETHForTokens' || method === 'swapExactTokensForETH' || method === 'swapExactTokensForTokens') {
        // Extract parameters based on ethers.js format
        let amountIn, amountOutMin;
        
        if (method === 'swapExactETHForTokens') {
          // For ETH input, use the transaction value
          amountIn = tx.valueInt;
          // Get amountOutMin from the first parameter
          amountOutMin = decodedData.amountOutMin || 
                        decodedData.args?.amountOutMin || 
                        (Array.isArray(decodedData) ? decodedData[0] : null);
        } else {
          // For token inputs, get both values from parameters
          amountIn = decodedData.amountIn || 
                     decodedData.args?.amountIn || 
                     (Array.isArray(decodedData) ? decodedData[0] : null);
                     
          amountOutMin = decodedData.amountOutMin || 
                         decodedData.args?.amountOutMin || 
                         (Array.isArray(decodedData) ? decodedData[1] : null);
        }
        
        if (amountIn && amountOutMin && tx.decodedSwap.path) {
          // If we have a price oracle or reserve data, we could calculate expected output
          // For now, we'll infer from common frontend slippage settings (0.1%, 0.5%, 1%, 3%)
          
          try {
            // Calculate a simple path impact factor (more hops = more slippage)
            const pathMultiplier = tx.decodedSwap.path.length > 2 ? 1.5 : 1.0;
            
            // Common settings are often rounded percentages
            // We can take the nearest match to common settings
            const possibleSettings = [0.1, 0.5, 1.0, 3.0];
            
            // Find closest match to common settings
            return possibleSettings.reduce((prev, curr) => {
              return Math.abs(curr - pathMultiplier) < Math.abs(prev - pathMultiplier) ? curr : prev;
            });
          } catch (e) {
            console.error("Error calculating slippage from parameters:", e);
            return 0.5; // Default fallback
          }
        }
      }
    }
    
    // For Uniswap V3
    else if (dex.includes('UNISWAP_V3')) {
      // Extract parameters for V3 methods
      if (method === 'exactInputSingle') {
        // Get the struct parameter
        const params = decodedData.args?.[0] || 
                      (Array.isArray(decodedData) ? decodedData[0] : null);
                      
        if (params) {
          const amountIn = params.amountIn;
          const amountOutMinimum = params.amountOutMinimum;
          const sqrtPriceLimitX96 = params.sqrtPriceLimitX96;
          
          if (amountIn && amountOutMinimum) {
            // Check for likely common slippage settings
            // For V3, UI typically offers 0.1%, 0.5%, 1%
            try {
              const inAmount = BigInt(amountIn.toString());
              const outMinAmount = BigInt(amountOutMinimum.toString());
              
              // If sqrtPriceLimit is set, user is likely using custom settings
              if (sqrtPriceLimitX96 && sqrtPriceLimitX96 !== '0') {
                return 0.05; // Very tight slippage likely
              }
              
              // Approximate expected output based on fee tier
              // Without actual price data, this is an estimate
              const feeTier = params.fee ? Number(params.fee) : 3000; // Default to 0.3% fee
              const approxFeePercent = feeTier / 10000;
              
              // Estimate price impact and infer slippage tolerance
              const estimatedImpact = approxFeePercent * 2; // Simple heuristic
              
              // Common settings on the V3 interface
              if (estimatedImpact <= 0.1) return 0.1;
              if (estimatedImpact <= 0.5) return 0.5;
              return 1.0;
            } catch (e) {
              return 0.5; // Default for V3
            }
          }
        }
      }
    }
    
    // For 1inch Router
    else if (dex.includes('1INCH') || dex === '1INCH_ROUTER') {
      // 1inch interface defaults changed across versions
      const version = tx.decodedSwap.routerVersion || '';
      
      if (method === 'swap') {
        // Try to extract from swap description struct
        const desc = decodedData.desc || decodedData.args?.[1];
        
        if (desc && desc.minReturnAmount && desc.amount) {
          try {
            // Check flags for hints about settings
            const flags = desc.flags ? Number(desc.flags) : 0;
            
            // Different flags indicate different settings
            // This is a simplification - actual flags are complex
            if (flags & 0x10) return 0.1; // Low slippage flag 
            if (flags & 0x20) return 3.0; // High slippage flag
            
            // Based on version
            if (version.includes('V6') || version.includes('V5')) {
              return 0.5; // Newer versions default lower
            }
            return 1.0; // Older versions default higher
          } catch (e) {
            return 1.0; // Default for 1inch
          }
        }
      }
      
      if (method === 'unoswap' || method.includes('unoswap')) {
        // Extract minReturn parameter
        const minReturn = decodedData.minReturn || 
                          (Array.isArray(decodedData) && decodedData.length > 2 ? decodedData[2] : null);
                          
        if (minReturn) {
          // Based on version
          if (version.includes('V6') || version.includes('V5')) {
            return 0.5;
          }
          return 1.0;
        }
      }
    }
    
    // If we couldn't calculate from parameters, fall back to method-based estimate
    return estimateSlippageFromMethod(tx);
    
  } catch (error) {
    console.error(`Error calculating actual slippage: ${error.message}`);
    // Fall back to method-based estimation
    return estimateSlippageFromMethod(tx);
  }
}

/**
 * Estimate slippage percentage based on the swap method
 * This uses typical values when exact calculation isn't possible
 */
// Helper to estimate slippage based on method
function estimateSlippageFromMethod(tx) {
  if (!tx.decodedSwap || !tx.decodedSwap.method) return null;
  
  const method = tx.decodedSwap.method;
  const dex = tx.decodedSwap.dex;
  
  // 1inch uses more complex routing, typically with higher default slippage
  if (dex === '1INCH_ROUTER') {
    // 1inch default is often 1%
    return 0.0; // we shall not estimate anything for now
  }
  
  // Common methods and their typical slippage values
  switch (method) {
    // Uni V2 style
    case 'swapExactETHForTokens':
    case 'swapExactTokensForETH':
    case 'swapExactTokensForTokens':
      return 0.0; // 0.5% default for exact input
      
    case 'swapETHForExactTokens':
    case 'swapTokensForExactETH':
    case 'swapTokensForExactTokens':
      return 0.0; // 1% default for exact output
      
    // Uni V3 style
    case 'exactInputSingle':
    case 'exactInput':
      return 0.0; // 0.5% default
      
    case 'exactOutputSingle':
    case 'exactOutput':
      return 0.0; // 1% default
      
    default:
      return 0.0; // Default fallback
  }
}
/**
 * Extract numerical slippage from transaction data
 * Returns a number representing slippage percentage or null if not available
 */
function extractNumericSlippage(tx) {
  if (!tx.isSwap || !tx.decodedSwap) return null;
  
  try {
    const { method, slippage, dex } = tx.decodedSwap;
    
    // First try to extract from the slippage string
    if (slippage) {
      // Try to find percentage values
      const percentMatch = String(slippage).match(/(\d+\.?\d*)%/);
      if (percentMatch && percentMatch[1]) {
        return parseFloat(percentMatch[1]);
      }
      
      // Try to extract numeric values from 'Min return:' format
      const minReturnMatch = String(slippage).match(/Min return: (\d+)/);
      if (minReturnMatch && minReturnMatch[1] && tx.decodedSwap.inputAmount) {
        // Calculate actual slippage if we have price data
        if (tx.decodedSwap.expectedOutput && tx.decodedSwap.minReturnAmount) {
          const expected = BigInt(tx.decodedSwap.expectedOutput);
          const minimum = BigInt(tx.decodedSwap.minReturnAmount);
          if (expected > minimum) {
            const slippageBps = Number((expected - minimum) * BigInt(10000) / expected);
            return slippageBps / 100; // Convert basis points to percentage
          }
        }
      
      }
    }

    // DEX and method-specific estimation
    if (dex === '1INCH_ROUTER') {
      // For 1inch router transactions
      if (tx.decodedSwap.decodedData && tx.decodedSwap.decodedData.decodingMethod === 'enhanced binary fallback') {
        // Check if we can find minReturn in the decoded data
        if (tx.decodedSwap.decodedData.minReturnAmount) {
          // If we have expected values, calculate actual slippage
          if (tx.decodedSwap.decodedData.expectedAmount) {
            try {
              const expected = BigInt(tx.decodedSwap.decodedData.expectedAmount);
              const minimum = BigInt(tx.decodedSwap.decodedData.minReturnAmount);
              if (expected > minimum) {
                const slippageBps = Number((expected - minimum) * BigInt(10000) / expected);
                return slippageBps / 100; // Convert basis points to percentage
              }
            } catch (e) {
              console.error("Error calculating slippage from values:", e);
            }
          }
        }
      }
    }
    
    // Then try to calculate from parameters
    const calculatedSlippage = calculateActualSlippage(tx);
    if (calculatedSlippage !== null) {
      return calculatedSlippage;
    }
    
    // Fall back to method-based estimation
    return estimateSlippageFromMethod(tx);
  } catch (error) {
    console.error(`Error extracting numeric slippage: ${error.message}`);
    return null;
  }
}


/**
 * Safe slippage extraction implementation - direct replacement for existing code
 * This version handles all error cases properly and will never crash
 */
function writeTransactionToCSV(tx) {
  try {
    const csvFilePath = 'temp_results.csv';
    
    // Check if file exists and create with headers if it doesn't
    if (!fs.existsSync(csvFilePath)) {
      const headers = 'hash,from,to,gasPrice,gas,value,gasPriceInt,gasInt,valueInt,nonce,nonceInt,poolType,isSwap,dex,method,slippage,slippageNumeric,slippageCategory,mevPotential,input,translatedInput,updatedAt\n';
      fs.writeFileSync(csvFilePath, headers);
    }
    
    // Prepare CSV row data with safe handling of all values
    const isSwap = tx.isSwap === true ? true : false;
    const dex = tx.dex || tx.decodedSwap?.dex || '';
    const method = tx.decodedSwap?.method || '';
    
    // Safe handling of slippage text - never undefined
    let slippage = '';
    if (tx.decodedSwap && tx.decodedSwap.slippage) {
      slippage = String(tx.decodedSwap.slippage).replace(/,/g, ';'); // Replace commas with semicolons
    }
    
    // Extract numeric slippage value and category
    let slippageNumeric = tx.slippageAbsolute ? `${tx.slippageAbsolute}` : '';
    let slippageCategory = 'UNKNOWN';
    let mevPotential = 'NO';
    
    if (isSwap) {
      try {
        if (tx.slippagePercentage > 0) {
          
          // Categorize
          if (tx.slippagePercentage < 0.5) slippageCategory = 'VERY_LOW';
          else if (tx.slippagePercentage < 1.0) slippageCategory = 'LOW';
          else if (tx.slippagePercentage < 2.0) slippageCategory = 'MEDIUM';
          else if (tx.slippagePercentage < 5.0) slippageCategory = 'HIGH';
          else slippageCategory = 'VERY_HIGH';
          
          // Flag high-potential MEV opportunities
          if (slippageCategory === 'HIGH' || slippageCategory === 'VERY_HIGH') {
            mevPotential = 'YES';
          }
        }
      } catch (e) {
        // If there's any error in slippage extraction, fall back to defaults
        console.error(`Error extracting slippage: ${e.message}`);
      }
    }
    
    // Store the extracted values back to the transaction object for ClickHouse insertion
    tx.slippageNumeric = slippageNumeric;
    tx.slippageCategory = slippageCategory;
    tx.mevPotential = mevPotential;
    
    // Handle the input field
    let inputData = '';
    if (tx.input) {
      // Escape the input data by wrapping in quotes and replacing any quotes inside
      inputData = '"' + String(tx.input).replace(/"/g, '""') + '"';
    }
    
    // Handle the translated input (from decodedSwap if available)
    let translatedInput = '';
    if (tx.decodedSwap) {
      try {
        // Create a simplified representation of the decoded data
        const decodedCopy = { ...tx.decodedSwap };
        if (decodedCopy.input) delete decodedCopy.input; // Remove the raw input to save space
        
        translatedInput = '"' + JSON.stringify(decodedCopy).replace(/"/g, '""') + '"';
      } catch (e) {
        translatedInput = '"Error creating translated input: ' + e.message.replace(/"/g, '""') + '"';
      }
    }
    
    // Create CSV row with safe defaults for all fields
    const csvRow = [
      tx.hash || '',
      tx.from || '',
      tx.to || '',
      tx.gasPrice || '',
      tx.gas || '',
      tx.value || '',
      tx.gasPriceInt || '',
      tx.gasInt || '',
      tx.valueInt || '',
      tx.nonce || '',
      tx.nonceInt || '',
      tx.poolType || '',
      isSwap,
      dex,
      method,
      slippage,
      slippageNumeric,
      slippageCategory,
      mevPotential,
      inputData,
      translatedInput,
      tx.updatedAt || Date.now()
    ].join(',') + '\n';
    
    // Append to CSV file
    fs.appendFileSync(csvFilePath, csvRow);
    
    // Insert into ClickHouse
    if (tx.dex && tx.dex.includes('UNISWAP')) console.log("UNISWAP_TX ", tx);
    insertTransactionToClickHouse(tx).catch(error => {
      console.error(`Failed to insert transaction ${tx.hash} into ClickHouse: ${error.message}`);
    });
  } catch (error) {
    // Fail gracefully - log error but don't crash application
    console.error('Error writing to CSV:', error);
  }
}


function getBlockNumber() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '160.202.131.49',
      port: 8545,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const data = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    });

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          const timestamp = new Date().toISOString();
          
          if (parsedData.result) {
            const blockNumberDec = parseInt(parsedData.result, 16);
            console.log(`[${timestamp}] Block number: ${blockNumberDec} (${parsedData.result})`);
          } else {
            console.log(`[${timestamp}] Response:`, parsedData);
          }
          resolve(parsedData);
        } catch (e) {
          console.error('Error parsing JSON:', e);
          reject(e);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error making request:', error);
      reject(error);
    });

    // Set a timeout for the request
    req.setTimeout(10000, () => {
      req.abort();
      console.error('Request timed out');
      reject(new Error('Request timed out'));
    });

    req.write(data);
    req.end();
  });
}

let tx_pool = {}

function getTxPoolContent() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '160.202.131.49',
      port: 8545,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const data = JSON.stringify({
      jsonrpc: '2.0',
      method: 'txpool_content',
      params: [],
      id: 1
    });

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          const timestamp = new Date().toISOString();
          
          if (parsedData.result) {
            // Process both pending and queued transactions
            if (parsedData.result.pending) {
              processTransactions(parsedData.result.pending, "pending");
            }
            if (parsedData.result.queued) {
              processTransactions(parsedData.result.queued, "queued");
            }
            
            console.log(`[${timestamp}] Transaction pool content processed`);
          } else {
            console.log(`[${timestamp}] Response:`, parsedData);
          }
          resolve(parsedData);
        } catch (e) {
          console.error('Error parsing JSON:', e);
          reject(e);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error making request:', error);
      reject(error);
    });

    // Set a timeout for the request
    req.setTimeout(10000, () => {
      req.abort();
      console.error('Request timed out');
      reject(new Error('Request timed out'));
    });

    req.write(data);
    req.end();
  });
}

/**
 * Process transactions from the pool - improved version with better error handling
 * @param {Object} pool - Transaction pool (pending or queued)
 * @param {String} poolType - Type of pool ('pending' or 'queued')
 */
async function processTransactions(pool, poolType) {
  console.log(`Processing Transactions for ${poolType} Pool Type`);
  let noNewChanges = true;
  let newChangesCount = 0;
  let typeChangesCount = 0;
  
  try {
    for (const address in pool) {
      for (const nonce in pool[address]) {
        try {
          const tx = pool[address][nonce];
          
          // Skip if already in pool with same poolType
          if (tx.hash in tx_pool && tx_pool[tx.hash].poolType === poolType) continue;
          
          if (tx.hash in tx_pool) {
            typeChangesCount++;
          }
          
          tx.poolType = poolType;
          
          // Convert hex values to decimal
          try {
            if (tx.gasPrice && tx.gasPrice.startsWith('0x')) {
              tx.gasPriceInt = BigInt(tx.gasPrice).toString();
            }
            
            if (tx.gas && tx.gas.startsWith('0x')) {
              tx.gasInt = BigInt(tx.gas).toString();
            }
            
            if (tx.nonce && tx.nonce.startsWith('0x')) {
              tx.nonceInt = BigInt(tx.nonce).toString();
            }
            
            if (tx.value && tx.value.startsWith('0x')) {
              tx.valueInt = BigInt(tx.value).toString();
            }
          } catch (conversionError) {
            console.error(`Error converting hex values for tx ${tx.hash}: ${conversionError.message}`);
          }
          
          // Try to identify DEX by address
          const dexName = Object.entries(DEX_ADDRESSES).find(
            ([key, addr]) => addr.toLowerCase() === tx.to?.toLowerCase()
          )?.[0];
          
          // Try to decode swap transaction data
          if (tx.input && tx.input.length > 10) {
            try {
              // // Always mark as potential swap if it's going to a known DEX
              // if (dexName && dexName.includes('ONEINCH_ROUTER')) {
              //   const methodSelector = tx.input.substring(0, 10).toLowerCase();
              //   console.log(`Transaction ${tx.hash} to ${dexName} with method ${methodSelector}`);
                
              //   // Decode the transaction
              //   const swapInfo = await decodeSwapTransaction(tx);
                
              //   // Even if decoding failed, mark as a swap for known DEX
              //   tx.isSwap = true;
              //   tx.decodedSwap = swapInfo.error 
              //     ? { 
              //         dex: swapInfo.dex ? swapInfo.dex : '1INCH_ROUTER', 
              //         method: methodSelector,
              //         slippage: `Unknown (${swapInfo.error})`,
              //         error: swapInfo.error
              //       }
              //     : swapInfo;
              //   tx.quoteBlockNumber = swapInfo.blocknumber
              //   tx.dex = swapInfo.dex
              //   tx.rawDecoded = swapInfo.rawDecoded
              //   tx.tokenOutSymbol = swapInfo.tokenOutSymbol
              //   tx.slippageAbsolute = swapInfo.slippageAbsolute
              //   tx.slippagePercentage = swapInfo.slippagePercentage
                  
              //   console.log(`Detected ${tx.decodedSwap.dex} swap: ${tx.hash}`);
              // } else {
                // Normal decoding for other DEXes
                const swapInfo = await decodeSwapTransaction(tx);
                console.log("swapInfo : ", swapInfo);
                if (swapInfo.isSwap) {
                  tx.decodedSwap = swapInfo;
                  tx.isSwap = true;
                  tx.quoteBlockNumber = swapInfo.blocknumber
                  tx.dex = swapInfo.dex
                  tx.rawDecoded = swapInfo.rawDecoded
                  tx.tokenOutSymbol = swapInfo.tokenOutSymbol
                  tx.slippageAbsolute = swapInfo.slippageAbsolute
                  tx.slippagePercentage = swapInfo.slippagePercentage
                  console.log(`Detected ${swapInfo.dex} swap: ${tx.hash}`);
                }
              // }
            } catch (swapError) {
              console.log("swapError ERROR");
              // For known DEXes, still mark as swap even on error
              if (dexName) {
                console.error(`Error decoding swap for known DEX ${dexName}: ${swapError.message}`);
                tx.isSwap = true;
                tx.decodedSwap = {
                  dex: dexName.includes('ONEINCH') ? '1INCH_ROUTER' : dexName,
                  method: tx.input.substring(0, 10),
                  slippage: 'Unknown (decoder error)',
                  error: swapError.message
                };
                tx.quoteBlockNumber = swapInfo.blocknumber
                tx.dex = swapInfo.dex
                tx.rawDecoded = swapInfo.rawDecoded
                tx.tokenOutSymbol = swapInfo.tokenOutSymbol
                tx.slippageAbsolute = swapInfo.slippageAbsolute
                tx.slippagePercentage = swapInfo.slippagePercentage
              } else {
                console.error(`Error decoding swap for tx ${tx.hash}: ${swapError.message}`);
              }
            }
          }
          
          tx.updatedAt = Date.now();
          noNewChanges = false;
          newChangesCount++;
          
          // Write transaction to CSV and update the tx_pool
          writeTransactionToCSV(tx);
          tx_pool[tx.hash] = tx;
        } catch (txError) {
          console.error(`Error processing transaction: ${txError.message}`);
        }
      }
    }
    
    if (noNewChanges) {
      console.log("No New Changes in TX_POOL");
    } else {
      console.log("Number of Changes: ", newChangesCount);
      console.log("Number of Transaction Type Changes: ", typeChangesCount);
    }
  } catch (poolError) {
    console.error(`Fatal error processing ${poolType} pool: ${poolError.message}`);
  }
}

// Common DEX router addresses (add more as needed)
const DEX_ADDRESSES = {
  UNISWAP_V2: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
  UNISWAP_V3: '0xe592427a0aece92de3edee1f18e0157c05861564',
  UNISWAP_V4: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af', // Uniswap v4 router

  // SUSHISWAP_V2: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f',
  // SUSHISWAP_REDSNWAPPER: '0xAC4c6e212A361c968F1725b4d055b47E63F80b75', // SushiSwap RedSnwapper aggregator
  // PANCAKESWAP: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
  
  // 1inch routers - multiple versions
  ONEINCH_ROUTER_V6: '0x111111125421cA6dc452d289314280a0f8842A65', // AggregationRouterV6
  // ONEINCH_ROUTER_V5: '0x1111111254EEB25477B68fb85Ed929f73A960582', // AggregationRouterV5
  // ONEINCH_ROUTER_V4: '0x1111111254fb6c44bAC0beD2854e76F90643097d', // V4
  // ONEINCH_ROUTER_V3: '0x11111112542d85b3ef69ae05771c2dccff4faa26', // V3
  // ONEINCH_ROUTER_V2: '0x111111125434b319222cdbf8c261674adb56f3ae', // V2
  
  
  // CoWSwap contracts
  // COWSWAP_SETTLEMENT: '0x9008d19f58aabd9ed0d60971565aa8510560ab41', // GPv2Settlement
  // COWSWAP_VAULT_RELAYER: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110', // GPv2VaultRelayer
  // COWSWAP_ALLOWANCE_MANAGER: '0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe', // GPv2AllowanceManager
  
  // SHIBASWAP: '0x03f7724180aa6b939894b5ca4314783b0b36b329', // ShibaSwap router
  // SAITASWAP: '0x5aa42afe655b2c9003dbffbae24b0fdf7f6cabbd', // SaitaSwap router
  // ETHERVISTA: '0x5b86f43d5daa33beea97a34d5f41c959fd12a662', // EtherVista router
  
  // Balancer
  // BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Main contract for Balancer swaps
  // BALANCER_EXCHANGE_PROXY: '0x3E66B66Fd1d0b02fDa6C811Da9E0547970DB2f21', // Exchange Proxy
};

const ADDITIONAL_1INCH_SELECTORS = {
  // Core methods across versions
  SWAP: '0x12aa3caf',                   // V4, V5, V6 swap method
  UNOSWAP: '0x0502b1c5',                // V4, V5, V6 unoswap method
  UNOSWAP_TO: '0x2e95b6c8',             // V5, V6 unoswapTo method
  UNISWAP_V3_SWAP: '0xe449022e',        // V4, V5, V6 uniswapV3Swap
  SWAP_V3: '0x7c025200',                // V3 swap method
  ALT_SWAP: '0x9570eeee',               // Possible alternative swap
  
  // V6-specific methods from your logs
  UNOSWAP_V6: '0x07ed2379',             // Common failing method in V6
  UNOSWAP_TO_V6: '0x83800a8e',          // Another common V6 method
  SWAP_V6_ALT: '0xb68fb020',            // Alternative V6 swap
  SWAP_V6_ALT2: '0xcc713a04',           // Another V6 method
  PERMIT_SWAP: '0xa76dfc3b',            // Permit and swap method
  
  // Additional methods found in ABIs
  ETH_UNOSWAP: '0xf7fcd384',            // ethUnoswap method
  ETH_UNOSWAP_TO: '0x33a3f5cf',         // ethUnoswapTo method
  CLIPPER_SWAP: '0xbbb9cc89',           // clipperSwap method
  PERMIT_AND_CALL: '0x57064646',        // permitAndCall method
};

// Common method selectors for swap functions
const METHOD_SELECTORS = {
  // Existing selectors for Uniswap V2 & forks
  SWAP_EXACT_ETH_FOR_TOKENS: '0x7ff36ab5',
  SWAP_ETH_FOR_EXACT_TOKENS: '0xfb3bdb41',
  SWAP_EXACT_TOKENS_FOR_ETH: '0x18cbafe5',
  SWAP_TOKENS_FOR_EXACT_ETH: '0x4a25d94a',
  SWAP_EXACT_TOKENS_FOR_TOKENS: '0x38ed1739',
  SWAP_TOKENS_FOR_EXACT_TOKENS: '0x8803dbee',

  // SushiSwap RedSnwapper methods
  SUSHISWAP_SNWAP: '0x5fcfbee3', // Function signature for snwap
  SUSHISWAP_SNWAP_MULTIPLE: '0x6f9ee52f', // Function signature for snwapMultiple
  
  // Existing Uniswap V3 selectors
  EXACT_INPUT_SINGLE: '0x414bf389',
  EXACT_OUTPUT_SINGLE: '0xdb3e2198',
  EXACT_INPUT: '0xc04b8d59',
  EXACT_OUTPUT: '0xf28c0498',

  // Uniswap V4 methods - update these after verification
  UNIV4_EXECUTE: '0x3593564c', // execute function with deadline
  UNIV4_EXECUTE_NO_DEADLINE: '0x4d5f327c', // execute function without deadline
  
  // 1inch Router methods
  ONEINCH_SWAP_FROM_CURVE: '0xbbb9cc89',
  ONEINCH_CLIPPER_SWAP: '0xb0431182',
  ONEINCH_FILL_ORDER: '0x9a85b484',
  ONEINCH_SWAP_V5: '0x12aa3caf',  // swap in V5
  ONEINCH_UNOSWAP_V5: '0x0502b1c5', // unoswap in V5
  ONEINCH_SWAP_V3: '0x7c025200',  // swap in V3
  ONEINCH_UNIV3SWAP: '0xe449022e', // uniswapV3Swap
  ONEINCH_UNOSWAP_TO: '0x2e95b6c8', // unoswapTo
  
  // Uniswap V4 methods
  UNIV4_EXECUTE: '0x3593564c', // execute function for the universal router
  UNIV4_EXECUTE_META_TRANSACTION: '0xf9c41624',
  
  // CoWSwap methods
  COWSWAP_SETTLE_TRADES: '0x7f6c8873', // settleTrades function
  COWSWAP_SET_PRICES: '0x35acddaa',
  
  // ShibaSwap methods (similar to Uniswap V2)
  SHIBASWAP_SWAP_EXACT_ETH_FOR_TOKENS: '0x7ff36ab5',
  SHIBASWAP_SWAP_EXACT_TOKENS_FOR_ETH: '0x18cbafe5',
  SHIBASWAP_SWAP_EXACT_TOKENS_FOR_TOKENS: '0x38ed1739',
  
  // SaitaSwap methods (similar to Uniswap V2)
  SAITASWAP_SWAP_EXACT_ETH_FOR_TOKENS: '0x7ff36ab5',
  SAITASWAP_SWAP_EXACT_TOKENS_FOR_ETH: '0x18cbafe5',
  SAITASWAP_SWAP_EXACT_TOKENS_FOR_TOKENS: '0x38ed1739',
  
  // EtherVista methods
  ETHERVISTA_SWAP: '0x12aa3caf',

  // Balancer methods
  BALANCER_BATCH_SWAP: '0x945bcec9',
  BALANCER_SWAP: '0x52bbbe29',
  BALANCER_JOIN_POOL: '0xb95cac28',
  BALANCER_EXIT_POOL: '0x8bdb3913',
  BALANCER_FLASH_LOAN: '0x51cff8d9',
};

/**
 * Helper to get the DEX from a method name
 */
function getDexFromMethodName(methodName) {
  if (methodName.includes('UNISWAP_V2')) return 'UNISWAP_V2';
  if (methodName.includes('UNISWAP_V3')) return 'UNISWAP_V3';
  if (methodName.includes('UNISWAP_V4')) return 'UNISWAP_V4';
  if (methodName.includes('ONEINCH')) return '1INCH';
  if (methodName.includes('SUSHISWAP_V2')) return 'SUSHISWAP_V2';
  if (methodName.includes('SUSHISWAP_REDSNWAPPER') || methodName.includes('SNWAP')) return 'SUSHISWAP_REDSNWAPPER';
  if (methodName.includes('COWSWAP')) return 'COWSWAP';
  if (methodName.includes('BALANCER')) return 'BALANCER';
  if (methodName.includes('SHIBASWAP')) return 'SHIBASWAP';
  if (methodName.includes('SAITASWAP')) return 'SAITASWAP';
  if (methodName.includes('ETHERVISTA')) return 'ETHERVISTA';
  return 'UNKNOWN';
}

/**
 * Helper function to identify which DEX uses a particular method selector
 * This is useful when debugging and troubleshooting unknown selectors
 */
function identifyMethodSelector(selector) {
  // Normalize the selector to lowercase
  selector = selector.toLowerCase();
  
  // If it doesn't start with 0x, add it
  if (!selector.startsWith('0x')) {
    selector = '0x' + selector;
  }
  
  // Create a mapping of all selectors to method names and DEXes
  const allSelectors = {};
  
  // Add all our known selectors
  for (const [key, value] of Object.entries(METHOD_SELECTORS)) {
    allSelectors[value] = { method: key, dex: getDexFromMethodName(key) };
  }
  
  // Additional 1inch selectors
  for (const [key, value] of Object.entries(ADDITIONAL_1INCH_SELECTORS)) {
    allSelectors[value] = { method: key, dex: '1INCH' };
  }
  
  // Look up the selector
  if (allSelectors[selector]) {
    return allSelectors[selector];
  }
  
  return { method: 'Unknown', dex: 'Unknown' };
}

function binaryFallback1inchDecoder(methodSelector, inputData, routerVersion) {
  console.log("1inch FALL BACK DECODER");
  try {
    // Get router version for better logging
    const version = routerVersion || 'unknown';

    // Map known method selectors to readable method names
    let methodName;
    let slippagePosition = -1; // Position where minReturn/slippage might be located
    
    switch(methodSelector) {
      // Core methods
      case '0x12aa3caf': 
        methodName = 'swap'; 
        slippagePosition = 5; // In SwapDescription struct
        break;
      case '0x0502b1c5': 
        methodName = 'unoswap'; 
        slippagePosition = 2; // minReturn is typically 3rd param
        break;
      case '0x2e95b6c8': 
        methodName = 'unoswapTo'; 
        slippagePosition = 3; // minReturn is typically 4th param
        break;
      case '0xe449022e': 
        methodName = 'uniswapV3Swap'; 
        slippagePosition = 1; // minReturn is typically 2nd param
        break;
      case '0x7c025200': 
        methodName = 'swap_v3'; 
        slippagePosition = 3; // minReturn is typically the 4th param
        break;
        
      // V6-specific methods
      case '0x07ed2379': 
        methodName = 'unoswapV6'; 
        slippagePosition = 2; // Estimated position for minReturn
        break;
      case '0x83800a8e': 
        methodName = 'unoswapToV6'; 
        slippagePosition = 3; // Estimated position for minReturn
        break;
      case '0xb68fb020': 
        methodName = 'swapV6Alt'; 
        slippagePosition = 5; // Estimated position for minReturn
        break;
      case '0xcc713a04': 
        methodName = 'swapV6Alt2'; 
        slippagePosition = 5; // Estimated position for minReturn
        break;
      case '0xa76dfc3b': 
        methodName = 'permitAndSwapV6'; 
        slippagePosition = 4; // Estimated position
        break;
      
      // Fallback
      default: 
        methodName = `unknown_${methodSelector}`;
    }
    
    // Extract potential slippage info
    let slippageInfo = 'Binary analysis mode - specific details unavailable';
    
    // If we have a likely position, try to get the parameter
    if (slippagePosition >= 0) {
      const paramOffset = 10 + (slippagePosition * 64);
      if (inputData.length >= paramOffset + 64) {
        const potentialMinReturn = '0x' + inputData.substring(paramOffset, paramOffset + 64);
        // Check if it's not all zeros
        if (!/^0x0*$/.test(potentialMinReturn)) {
          try {
            // Try to convert to a readable number
            const minReturnBigInt = BigInt(potentialMinReturn);
            if (minReturnBigInt > 0) {
              slippageInfo = `Potential minReturn: ${minReturnBigInt.toString()}`;
            }
          } catch (e) {
            // If conversion fails, just use the hex value
            slippageInfo = `Potential minReturn at position ${slippagePosition}: ${potentialMinReturn}`;
          }
        }
      }
    }
    
    // Extract input amount if available (for estimating slippage)
    let inputAmount = null;
    // Input amount is often at position 4 in swap methods
    const amountPosition = (methodName.includes('swap')) ? 4 : 2;
    const amountOffset = 10 + (amountPosition * 64);
    
    if (inputData.length >= amountOffset + 64) {
      const potentialAmount = '0x' + inputData.substring(amountOffset, amountOffset + 64);
      try {
        const amountBigInt = BigInt(potentialAmount);
        if (amountBigInt > 0) {
          inputAmount = amountBigInt.toString();
        }
      } catch (e) {
        // Ignore errors in amount extraction
      }
    }
    
    return {
      isSwap: true,
      dex: '1INCH_ROUTER',
      routerVersion: version,
      method: methodName,
      slippage: slippageInfo,
      inputAmount: inputAmount,
      decodedData: {
        methodSelector,
        dataLength: inputData.length,
        decodingMethod: 'enhanced binary fallback'
      }
    };
  } catch (error) {
    console.error(`Error in binary fallback decoder: ${error.message}`);
    return {
      isSwap: true,
      dex: '1INCH_ROUTER',
      method: methodSelector,
      slippage: 'Error in fallback decoder',
      error: error.message
    };
  }
}

/**
 * Enhanced main function to decode swap transaction with better fallbacks
 * @param {Object} transaction - Transaction object from txpool
 * @returns {Object} - Object containing isSwap (boolean) and swap details
 */
async function decodeSwapTransaction(transaction) {
  // Default return if no match
  const defaultResult = { isSwap: false, input: transaction.input };
  
  // Validate inputs
  if (!transaction || !transaction.input || !transaction.to) {
    return defaultResult;
  }
  
  // Get the method selector (first 4 bytes of the input data)
  // Reference: https://docs.soliditylang.org/en/latest/abi-spec.html. The first four bytes of the call data for a function call specifies the function to be called.
  const methodSelector = transaction.input.substring(0, 10).toLowerCase();
  
  // Normalize addresses for comparison
  const toAddress = transaction.to.toLowerCase();
  
  // Find a matching DEX address
  const dexEntry = Object.entries(DEX_ADDRESSES).find(
    ([key, value]) => value.toLowerCase() === toAddress
  );
  
  if (!dexEntry) {
    return defaultResult;
  }
  
  const dexKey = dexEntry[0];
  
  try {
    let result;
    
    // Determine which decoder to use based on the DEX key
    // 1inch Routers (all versions) - Now using our enhanced decoder with ABI-specific interfaces
    if (dexKey.includes('ONEINCH_ROUTER_V6')) {
      let rawDecoded = oneInchV6Decoder(transaction)
      // console.log("========= TEST START ! =========");
      // Version check for ethers.js
      let stringifiedRawDecoded = JSON.stringify(rawDecoded, (key, value) => typeof value === 'bigint' ? value.toString() : value)
      // console.log("ONEINCH_ROUTER_V6 rawDecoded : ", rawDecoded);
      // console.log("ONEINCH_ROUTER_V6 string : ", stringifiedRawDecoded);
      let slippage = await getV6Slippage(rawDecoded)
      result = {
        isSwap: true,
        dex: dexKey,
        method: rawDecoded.name,
        rawDecoded: stringifiedRawDecoded,
        slippage: 'Unknown (method not recognized)',
        slippageAbsolute: slippage.slippageAbsolute ? slippage.slippageAbsolute : 0,
        slippagePercentage: slippage.slippagePercentage ? slippage.slippagePercentage : 0,
        input: transaction.input
      }
      // console.log("========= TEST RESULT ========= ! :\n ", result);
      // console.log("========= TEST END ========= !");
    } else if (dexKey.includes('UNISWAP_V2')) {
      console.log("UNISWAP_V2");
      // console.log("========= TEST START ! =========");
      let rawDecoded = uniswapV2Decoder(transaction)
      let stringifiedRawDecoded = JSON.stringify(rawDecoded, (key, value) => typeof value === 'bigint' ? value.toString() : value)
      let slippage = await getV2Slippage(rawDecoded)
      // console.log("uniswapV2Interfacecl rawDecoded : ", rawDecoded);
      result = {
        isSwap: true,
        dex: dexKey,
        method: rawDecoded.name,
        rawDecoded: stringifiedRawDecoded,
        slippage: 'Unknown (method not recognized)',
        slippageAbsolute: slippage.slippageAbsolute ? slippage.slippageAbsolute : 0,
        slippagePercentage: slippage.slippagePercentage ? slippage.slippagePercentage : 0,
        input: transaction.input
      }
      // console.log("========= TEST RESULT ========= ! :\n ", result);
      // console.log("========= TEST END ========= !");
      // result = decodeUniswapV2Transaction(methodSelector, transaction.input, dexKey);
      
    } else if (dexKey.includes('UNISWAP_V3')) {
      console.log("UNISWAP_V3");
      // exactInputSingle, exactInput
      
      let rawDecoded = uniswapV3Decoder(transaction)
      let stringifiedRawDecoded = JSON.stringify(rawDecoded, (key, value) => typeof value === 'bigint' ? value.toString() : value)
      // let slippage = getV2Slippage(rawDecoded)
      let slippage = rawDecoded ? await getV3Slippage(rawDecoded) : {quote: {}, slippageAbsolute: 0, slippagePercentage: 0}
      result = {
        isSwap: true,
        dex: dexKey,
        method: rawDecoded.name,
        rawDecoded: stringifiedRawDecoded,
        slippage: 'Unknown (method not recognized)',
        slippageAbsolute: slippage.slippageAbsolute ? slippage.slippageAbsolute : 0,
        slippagePercentage: slippage.slippagePercentage ? slippage.slippagePercentage : 0,
        input: transaction.input
      }
      // result = decodeUniswapV3Transaction(methodSelector, transaction.input);
      
    }
    else if (dexKey.includes('UNISWAP_V4')) {
      console.log("UNISWAP_V4");
      let rawDecoded = uniswapV4Decoder(transaction)
      let stringifiedRawDecoded = JSON.stringify(rawDecoded, (key, value) => typeof value === 'bigint' ? value.toString() : value)
      let slippage = rawDecoded ? await getV4Slippage(rawDecoded) : {quote: {}, slippageAbsolute: 0, slippagePercentage: 0}
      result = {
        isSwap: true,
        dex: dexKey,
        method: rawDecoded.name,
        rawDecoded: stringifiedRawDecoded,
        slippage: 'Unknown (method not recognized)',
        slippageAbsolute: slippage.slippageAbsolute ? slippage.slippageAbsolute : 0,
        slippagePercentage: slippage.slippagePercentage ? slippage.slippagePercentage : 0,
        input: transaction.input
      }
      // result = decodeUniswapV4Transaction(methodSelector, transaction.input);
    } else {
      result = {
        isSwap: true,
        dex: dexKey,
        method: methodSelector,
        slippage: 'Unknown (method not recognized)',
        input: transaction.input
      };
    }
    
    // Check if decoding failed and use the generic fallback if needed
    if (result.error) {
      console.warn(`Warning: Primary decoder failed for ${dexKey} transaction ${transaction.hash}: ${result.error}`);
      console.log(`Attempting fallback decoder for transaction ${transaction.hash}`);
      
      const fallbackResult = genericFallbackDecoder(methodSelector, transaction.input, transaction.to);
      
      // Only use fallback if it identified as a swap
      if (fallbackResult.isSwap) {
        return {
          ...fallbackResult,
          originalError: result.error,
          decodedData: { 
            dex: fallbackResult.dex,
            method: fallbackResult.method,
            slippage: fallbackResult.slippage
          }
        };
      }
    }
    return result;
  } catch (mainError) {
    console.error(`Critical error in decodeSwapTransaction: ${mainError.message}`);
    
    // Ultimate fallback - ensure we always return a valid object
    // This will never throw an error and always mark transactions to DEX addresses as swaps
    const toAddr = transaction.to ? transaction.to.toLowerCase() : '';
    const inpData = transaction.input || '';
    const methodSel = inpData.length >= 10 ? inpData.substring(0, 10) : 'invalid';
    
    // See if this is a known DEX
    const isDex = Object.values(DEX_ADDRESSES).some(addr => 
      addr.toLowerCase() === toAddr
    );
    
    const dexEntry = Object.entries(DEX_ADDRESSES).find(([k, v]) => 
      v.toLowerCase() === toAddr
    );
    
    const dexName = dexEntry ? dexEntry[0] : "UNKNOWN_DEX";
    
    // Build minimal object that won't break the rest of the code
    return {
      isSwap: isDex,
      dex: isDex ? dexName : "UNKNOWN",
      method: methodSel,
      slippage: "Unknown (global error handler)",
      error: mainError.message,
      globalFallback: true,
      input: inpData
    };
  }
    
}

/**
 * Decode Uniswap V2 transaction
 * @param {String} methodSelector - Function signature
 * @param {String} inputData - Transaction input data
 * @param {String} dexName - Name of the DEX
 * @returns {Object} - Decoded transaction data with slippage info
 */
function decodeUniswapV2Transaction(methodSelector, inputData, dexName) {
  try {
    // Version check for ethers.js
    let uniswapV2Interface;
    
    if (ethers.Interface) {
      uniswapV2Interface = new ethers.Interface([
        'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
        'function swapETHForExactTokens(uint amountOut, address[] path, address to, uint deadline) payable',
        'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
        'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] path, address to, uint deadline)',
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
        'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] path, address to, uint deadline)'
      ]);
    } else if (ethers.utils && ethers.utils.Interface) {
      uniswapV2Interface = new ethers.utils.Interface([
        'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
        'function swapETHForExactTokens(uint amountOut, address[] path, address to, uint deadline) payable',
        'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
        'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] path, address to, uint deadline)',
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
        'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] path, address to, uint deadline)'
      ]);
    } else {
      throw new Error("Ethers.js Interface not found - check ethers version");
    }
    
    let decodedData;
    let slippageInfo;
    
    switch (methodSelector) {
      case METHOD_SELECTORS.SWAP_EXACT_ETH_FOR_TOKENS:
        decodedData = uniswapV2Interface.decodeFunctionData('swapExactETHForTokens', inputData);
        slippageInfo = calculateSlippage(null, decodedData.amountOutMin?.toString(), 'minimum output');
        break;
        
      case METHOD_SELECTORS.SWAP_ETH_FOR_EXACT_TOKENS:
        decodedData = uniswapV2Interface.decodeFunctionData('swapETHForExactTokens', inputData);
        slippageInfo = 'Fixed output amount, slippage applied to input amount';
        break;
        
      case METHOD_SELECTORS.SWAP_EXACT_TOKENS_FOR_ETH:
        decodedData = uniswapV2Interface.decodeFunctionData('swapExactTokensForETH', inputData);
        slippageInfo = calculateSlippage(decodedData.amountIn?.toString(), decodedData.amountOutMin?.toString(), 'minimum output');
        break;
        
      case METHOD_SELECTORS.SWAP_TOKENS_FOR_EXACT_ETH:
        decodedData = uniswapV2Interface.decodeFunctionData('swapTokensForExactETH', inputData);
        slippageInfo = calculateSlippage(decodedData.amountInMax?.toString(), null, 'maximum input');
        break;
        
      case METHOD_SELECTORS.SWAP_EXACT_TOKENS_FOR_TOKENS:
        decodedData = uniswapV2Interface.decodeFunctionData('swapExactTokensForTokens', inputData);
        slippageInfo = calculateSlippage(decodedData.amountIn?.toString(), decodedData.amountOutMin?.toString(), 'minimum output');
        break;
        
      case METHOD_SELECTORS.SWAP_TOKENS_FOR_EXACT_TOKENS:
        decodedData = uniswapV2Interface.decodeFunctionData('swapTokensForExactTokens', inputData);
        slippageInfo = calculateSlippage(decodedData.amountInMax?.toString(), null, 'maximum input');
        break;
        
      default:
        return {
          isSwap: true,
          dex: dexName,
          method: methodSelector,
          slippage: 'Unknown (method not recognized)',
          input: inputData
        };
    }

    // Handle the deadline format - could be a BigNumber or a regular number
    let deadlineTimestamp;
    try {
      // Check if deadline is a BigNumber (ethers v5)
      if (decodedData.deadline && typeof decodedData.deadline.toNumber === 'function') {
        deadlineTimestamp = new Date(decodedData.deadline.toNumber() * 1000).toISOString();
      } 
      // Check if deadline is in args array (ethers v6)
      else if (decodedData.args && decodedData.args.deadline) {
        const deadline = decodedData.args.deadline;
        if (typeof deadline.toNumber === 'function') {
          deadlineTimestamp = new Date(deadline.toNumber() * 1000).toISOString();
        } else {
          deadlineTimestamp = new Date(Number(deadline) * 1000).toISOString();
        }
      }
      // Other formats
      else if (decodedData.deadline) {
        deadlineTimestamp = new Date(Number(decodedData.deadline) * 1000).toISOString();
      } else {
        deadlineTimestamp = "Unknown";
      }
    } catch (e) {
      console.error("Error formatting deadline:", e);
      deadlineTimestamp = "Error parsing deadline";
    }
    
    return {
      isSwap: true,
      dex: dexName,
      method: getFunctionNameFromSelector(methodSelector),
      slippage: slippageInfo,
      path: decodedData.path || decodedData.args?.path || [],
      deadline: deadlineTimestamp,
      decodedData: JSON.parse(JSON.stringify(decodedData, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      ))
    };
  } catch (error) {
    console.error(`Error in decodeUniswapV2Transaction: ${error.message}`);
    return {
      isSwap: true,
      dex: dexName,
      method: getFunctionNameFromSelector(methodSelector),
      slippage: "Unknown (decoding error)",
      error: error.message,
      input: inputData
    };
  }
}

/**
 * Decode Uniswap V3 transaction
 * @param {String} methodSelector - Function signature
 * @param {String} inputData - Transaction input data
 * @returns {Object} - Decoded transaction data with slippage info
 */
function decodeUniswapV3Transaction(methodSelector, inputData) {
  try {
    let uniswapV3Interface;
    
    if (ethers.Interface) {
      uniswapV3Interface = new ethers.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
        'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
        'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
        'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)'
      ]);
    } else if (ethers.utils && ethers.utils.Interface) {
      uniswapV3Interface = new ethers.utils.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
        'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
        'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
        'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)'
      ]);
    } else {
      throw new Error("Ethers.js Interface not found - check ethers version");
    }
    
    let decodedData;
    let slippageInfo;
    let param, deadline;
    
    switch (methodSelector) {
      case METHOD_SELECTORS.EXACT_INPUT_SINGLE:
        decodedData = uniswapV3Interface.decodeFunctionData('exactInputSingle', inputData);
        param = decodedData[0] || decodedData.args?.[0];
        if (!param) throw new Error("Could not extract parameters from decoded data");
        
        slippageInfo = calculateSlippage(
          param.amountIn?.toString(), 
          param.amountOutMinimum?.toString(),
          'minimum output'
        );
        deadline = param.deadline;
        break;
        
      case METHOD_SELECTORS.EXACT_OUTPUT_SINGLE:
        decodedData = uniswapV3Interface.decodeFunctionData('exactOutputSingle', inputData);
        param = decodedData[0] || decodedData.args?.[0];
        if (!param) throw new Error("Could not extract parameters from decoded data");
        
        slippageInfo = calculateSlippage(
          param.amountInMaximum?.toString(),
          null,
          'maximum input'
        );
        deadline = param.deadline;
        break;
        
      case METHOD_SELECTORS.EXACT_INPUT:
        decodedData = uniswapV3Interface.decodeFunctionData('exactInput', inputData);
        param = decodedData[0] || decodedData.args?.[0];
        if (!param) throw new Error("Could not extract parameters from decoded data");
        
        slippageInfo = calculateSlippage(
          param.amountIn?.toString(),
          param.amountOutMinimum?.toString(),
          'minimum output'
        );
        deadline = param.deadline;
        break;
        
      case METHOD_SELECTORS.EXACT_OUTPUT:
        decodedData = uniswapV3Interface.decodeFunctionData('exactOutput', inputData);
        param = decodedData[0] || decodedData.args?.[0];
        if (!param) throw new Error("Could not extract parameters from decoded data");
        
        slippageInfo = calculateSlippage(
          param.amountInMaximum?.toString(),
          null,
          'maximum input'
        );
        deadline = param.deadline;
        break;
        
      default:
        return {
          isSwap: true,
          dex: 'UNISWAP_V3',
          method: methodSelector,
          slippage: 'Unknown (method not recognized)',
          input: inputData
        };
    }
    
    // Convert deadline to ISO string safely
    let deadlineTimestamp;
    try {
      if (deadline) {
        if (typeof deadline.toNumber === 'function') {
          deadlineTimestamp = new Date(deadline.toNumber() * 1000).toISOString();
        } else {
          deadlineTimestamp = new Date(Number(deadline) * 1000).toISOString();
        }
      } else {
        deadlineTimestamp = "Unknown";
      }
    } catch (e) {
      console.error("Error formatting deadline:", e);
      deadlineTimestamp = "Error parsing deadline";
    }
    
    return {
      isSwap: true,
      dex: 'UNISWAP_V3',
      method: getFunctionNameFromSelector(methodSelector),
      slippage: slippageInfo,
      deadline: deadlineTimestamp,
      // Convert BigInt to strings for JSON serialization
      decodedData: JSON.parse(JSON.stringify(decodedData, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      ))
    };
  } catch (error) {
    console.error(`Error in decodeUniswapV3Transaction: ${error.message}`);
    return {
      isSwap: true,
      dex: 'UNISWAP_V3',
      method: getFunctionNameFromSelector(methodSelector),
      slippage: "Unknown (decoding error)",
      error: error.message,
      input: inputData
    };
  }
}

// Update all V6-related method handling to be consistent
// Create a generalized V6 method handler for all the unknown methods
function handleV6Method(methodSelector, inputData) {
  // Map selectors to potential method names based on API patterns
  let methodName;
  let slippagePosition = 2; // Default position for minReturn
  
  // Try to match to known V6 API method patterns
  if (methodSelector === '0x07ed2379') {
    methodName = 'unoswap';
  } 
  else if (methodSelector === '0x83800a8e') {
    methodName = 'unoswapTo';
    slippagePosition = 3;
  }
  else if (methodSelector === '0xb68fb020') {
    methodName = 'unoswap2';
  }
  else if (methodSelector === '0xcc713a04') {
    methodName = 'unoswap3';
  }
  else if (methodSelector === '0xa76dfc3b') {
    methodName = 'permitAndCall';
    slippagePosition = 4;
  }
  else {
    methodName = `unknown_${methodSelector}`;
  }
  
  // Extract potential minReturn parameter
  let slippageInfo = "Binary format";
  const paramOffset = 10 + (slippagePosition * 64);
  
  if (inputData.length >= paramOffset + 64) {
    const potentialMinReturn = '0x' + inputData.substring(paramOffset, paramOffset + 64);
    if (!/^0x0*$/.test(potentialMinReturn)) {
      try {
        const minReturnBigInt = BigInt(potentialMinReturn);
        if (minReturnBigInt > 0) {
          slippageInfo = `MinReturn: ${minReturnBigInt.toString()}`;
        }
      } catch (e) {
        // Ignore conversion errors
      }
    }
  }

  // new ethers.Interface([{"inputs":[{"internalType":"contract IWETH","name":"weth","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"AdvanceEpochFailed","type":"error"},{"inputs":[],"name":"ArbitraryStaticCallFailed","type":"error"},{"inputs":[],"name":"BadCurveSwapSelector","type":"error"},{"inputs":[],"name":"BadPool","type":"error"},{"inputs":[],"name":"BadSignature","type":"error"},{"inputs":[],"name":"BitInvalidatedOrder","type":"error"},{"inputs":[],"name":"ETHTransferFailed","type":"error"},{"inputs":[],"name":"ETHTransferFailed","type":"error"},{"inputs":[],"name":"EnforcedPause","type":"error"},{"inputs":[],"name":"EpochManagerAndBitInvalidatorsAreIncompatible","type":"error"},{"inputs":[],"name":"EthDepositRejected","type":"error"},{"inputs":[],"name":"ExpectedPause","type":"error"},{"inputs":[],"name":"InsufficientBalance","type":"error"},{"inputs":[],"name":"InvalidMsgValue","type":"error"},{"inputs":[],"name":"InvalidMsgValue","type":"error"},{"inputs":[],"name":"InvalidPermit2Transfer","type":"error"},{"inputs":[],"name":"InvalidShortString","type":"error"},{"inputs":[],"name":"InvalidatedOrder","type":"error"},{"inputs":[],"name":"MakingAmountTooLow","type":"error"},{"inputs":[],"name":"MismatchArraysLengths","type":"error"},{"inputs":[],"name":"OrderExpired","type":"error"},{"inputs":[],"name":"OrderIsNotSuitableForMassInvalidation","type":"error"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"OwnableInvalidOwner","type":"error"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"OwnableUnauthorizedAccount","type":"error"},{"inputs":[],"name":"PartialFillNotAllowed","type":"error"},{"inputs":[],"name":"Permit2TransferAmountTooHigh","type":"error"},{"inputs":[],"name":"PredicateIsNotTrue","type":"error"},{"inputs":[],"name":"PrivateOrder","type":"error"},{"inputs":[],"name":"ReentrancyDetected","type":"error"},{"inputs":[],"name":"RemainingInvalidatedOrder","type":"error"},{"inputs":[],"name":"ReservesCallFailed","type":"error"},{"inputs":[{"internalType":"uint256","name":"result","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"}],"name":"ReturnAmountIsNotEnough","type":"error"},{"inputs":[],"name":"SafeTransferFailed","type":"error"},{"inputs":[],"name":"SafeTransferFromFailed","type":"error"},{"inputs":[{"internalType":"bool","name":"success","type":"bool"},{"internalType":"bytes","name":"res","type":"bytes"}],"name":"SimulationResults","type":"error"},{"inputs":[{"internalType":"string","name":"str","type":"string"}],"name":"StringTooLong","type":"error"},{"inputs":[],"name":"SwapWithZeroAmount","type":"error"},{"inputs":[],"name":"TakingAmountExceeded","type":"error"},{"inputs":[],"name":"TakingAmountTooHigh","type":"error"},{"inputs":[],"name":"TransferFromMakerToTakerFailed","type":"error"},{"inputs":[],"name":"TransferFromTakerToMakerFailed","type":"error"},{"inputs":[],"name":"WrongSeriesNonce","type":"error"},{"inputs":[],"name":"ZeroAddress","type":"error"},{"inputs":[],"name":"ZeroMinReturn","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"maker","type":"address"},{"indexed":false,"internalType":"uint256","name":"slotIndex","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"slotValue","type":"uint256"}],"name":"BitInvalidatorUpdated","type":"event"},{"anonymous":false,"inputs":[],"name":"EIP712DomainChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"maker","type":"address"},{"indexed":false,"internalType":"uint256","name":"series","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newEpoch","type":"uint256"}],"name":"EpochIncreased","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderHash","type":"bytes32"}],"name":"OrderCancelled","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderHash","type":"bytes32"},{"indexed":false,"internalType":"uint256","name":"remainingAmount","type":"uint256"}],"name":"OrderFilled","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"account","type":"address"}],"name":"Paused","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"account","type":"address"}],"name":"Unpaused","type":"event"},{"inputs":[{"internalType":"uint96","name":"series","type":"uint96"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"advanceEpoch","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"offsets","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"and","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"arbitraryStaticCall","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"maker","type":"address"},{"internalType":"uint256","name":"slot","type":"uint256"}],"name":"bitInvalidatorForOrder","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"},{"internalType":"uint256","name":"additionalMask","type":"uint256"}],"name":"bitsInvalidateForOrder","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"},{"internalType":"bytes32","name":"orderHash","type":"bytes32"}],"name":"cancelOrder","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"MakerTraits[]","name":"makerTraits","type":"uint256[]"},{"internalType":"bytes32[]","name":"orderHashes","type":"bytes32[]"}],"name":"cancelOrders","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes","name":"predicate","type":"bytes"}],"name":"checkPredicate","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract IClipperExchange","name":"clipperExchange","type":"address"},{"internalType":"Address","name":"srcToken","type":"uint256"},{"internalType":"contract IERC20","name":"dstToken","type":"address"},{"internalType":"uint256","name":"inputAmount","type":"uint256"},{"internalType":"uint256","name":"outputAmount","type":"uint256"},{"internalType":"uint256","name":"goodUntil","type":"uint256"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"vs","type":"bytes32"}],"name":"clipperSwap","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"contract IClipperExchange","name":"clipperExchange","type":"address"},{"internalType":"address payable","name":"recipient","type":"address"},{"internalType":"Address","name":"srcToken","type":"uint256"},{"internalType":"contract IERC20","name":"dstToken","type":"address"},{"internalType":"uint256","name":"inputAmount","type":"uint256"},{"internalType":"uint256","name":"outputAmount","type":"uint256"},{"internalType":"uint256","name":"goodUntil","type":"uint256"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"vs","type":"bytes32"}],"name":"clipperSwapTo","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"inCoin","type":"address"},{"internalType":"uint256","name":"dx","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"curveSwapCallback","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"eip712Domain","outputs":[{"internalType":"bytes1","name":"fields","type":"bytes1"},{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"version","type":"string"},{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"verifyingContract","type":"address"},{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"uint256[]","name":"extensions","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"maker","type":"address"},{"internalType":"uint96","name":"series","type":"uint96"}],"name":"epoch","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"maker","type":"address"},{"internalType":"uint256","name":"series","type":"uint256"},{"internalType":"uint256","name":"makerEpoch","type":"uint256"}],"name":"epochEquals","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"eq","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"}],"name":"ethUnoswap","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"}],"name":"ethUnoswap2","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"},{"internalType":"Address","name":"dex3","type":"uint256"}],"name":"ethUnoswap3","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"Address","name":"to","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"}],"name":"ethUnoswapTo","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"Address","name":"to","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"}],"name":"ethUnoswapTo2","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"Address","name":"to","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"},{"internalType":"Address","name":"dex3","type":"uint256"}],"name":"ethUnoswapTo3","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"components":[{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"Address","name":"maker","type":"uint256"},{"internalType":"Address","name":"receiver","type":"uint256"},{"internalType":"Address","name":"makerAsset","type":"uint256"},{"internalType":"Address","name":"takerAsset","type":"uint256"},{"internalType":"uint256","name":"makingAmount","type":"uint256"},{"internalType":"uint256","name":"takingAmount","type":"uint256"},{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"}],"internalType":"struct IOrderMixin.Order","name":"order","type":"tuple"},{"internalType":"bytes","name":"signature","type":"bytes"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"TakerTraits","name":"takerTraits","type":"uint256"}],"name":"fillContractOrder","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"Address","name":"maker","type":"uint256"},{"internalType":"Address","name":"receiver","type":"uint256"},{"internalType":"Address","name":"makerAsset","type":"uint256"},{"internalType":"Address","name":"takerAsset","type":"uint256"},{"internalType":"uint256","name":"makingAmount","type":"uint256"},{"internalType":"uint256","name":"takingAmount","type":"uint256"},{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"}],"internalType":"struct IOrderMixin.Order","name":"order","type":"tuple"},{"internalType":"bytes","name":"signature","type":"bytes"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"TakerTraits","name":"takerTraits","type":"uint256"},{"internalType":"bytes","name":"args","type":"bytes"}],"name":"fillContractOrderArgs","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"Address","name":"maker","type":"uint256"},{"internalType":"Address","name":"receiver","type":"uint256"},{"internalType":"Address","name":"makerAsset","type":"uint256"},{"internalType":"Address","name":"takerAsset","type":"uint256"},{"internalType":"uint256","name":"makingAmount","type":"uint256"},{"internalType":"uint256","name":"takingAmount","type":"uint256"},{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"}],"internalType":"struct IOrderMixin.Order","name":"order","type":"tuple"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"vs","type":"bytes32"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"TakerTraits","name":"takerTraits","type":"uint256"}],"name":"fillOrder","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"payable","type":"function"},{"inputs":[{"components":[{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"Address","name":"maker","type":"uint256"},{"internalType":"Address","name":"receiver","type":"uint256"},{"internalType":"Address","name":"makerAsset","type":"uint256"},{"internalType":"Address","name":"takerAsset","type":"uint256"},{"internalType":"uint256","name":"makingAmount","type":"uint256"},{"internalType":"uint256","name":"takingAmount","type":"uint256"},{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"}],"internalType":"struct IOrderMixin.Order","name":"order","type":"tuple"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"vs","type":"bytes32"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"TakerTraits","name":"takerTraits","type":"uint256"},{"internalType":"bytes","name":"args","type":"bytes"}],"name":"fillOrderArgs","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"gt","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"components":[{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"Address","name":"maker","type":"uint256"},{"internalType":"Address","name":"receiver","type":"uint256"},{"internalType":"Address","name":"makerAsset","type":"uint256"},{"internalType":"Address","name":"takerAsset","type":"uint256"},{"internalType":"uint256","name":"makingAmount","type":"uint256"},{"internalType":"uint256","name":"takingAmount","type":"uint256"},{"internalType":"MakerTraits","name":"makerTraits","type":"uint256"}],"internalType":"struct IOrderMixin.Order","name":"order","type":"tuple"}],"name":"hashOrder","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint96","name":"series","type":"uint96"}],"name":"increaseEpoch","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"lt","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"data","type":"bytes"}],"name":"not","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"offsets","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"or","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pause","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"paused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"permit","type":"bytes"},{"internalType":"bytes","name":"action","type":"bytes"}],"name":"permitAndCall","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"maker","type":"address"},{"internalType":"bytes32","name":"orderHash","type":"bytes32"}],"name":"rawRemainingInvalidatorForOrder","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"maker","type":"address"},{"internalType":"bytes32","name":"orderHash","type":"bytes32"}],"name":"remainingInvalidatorForOrder","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IERC20","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"rescueFunds","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"simulate","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IAggregationExecutor","name":"executor","type":"address"},{"components":[{"internalType":"contract IERC20","name":"srcToken","type":"address"},{"internalType":"contract IERC20","name":"dstToken","type":"address"},{"internalType":"address payable","name":"srcReceiver","type":"address"},{"internalType":"address payable","name":"dstReceiver","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturnAmount","type":"uint256"},{"internalType":"uint256","name":"flags","type":"uint256"}],"internalType":"struct GenericRouter.SwapDescription","name":"desc","type":"tuple"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"swap","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"},{"internalType":"uint256","name":"spentAmount","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"int256","name":"amount0Delta","type":"int256"},{"internalType":"int256","name":"amount1Delta","type":"int256"},{"internalType":"bytes","name":"","type":"bytes"}],"name":"uniswapV3SwapCallback","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"Address","name":"token","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"}],"name":"unoswap","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"Address","name":"token","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"}],"name":"unoswap2","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"Address","name":"token","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"},{"internalType":"Address","name":"dex3","type":"uint256"}],"name":"unoswap3","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"Address","name":"to","type":"uint256"},{"internalType":"Address","name":"token","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"}],"name":"unoswapTo","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"Address","name":"to","type":"uint256"},{"internalType":"Address","name":"token","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"}],"name":"unoswapTo2","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"Address","name":"to","type":"uint256"},{"internalType":"Address","name":"token","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"minReturn","type":"uint256"},{"internalType":"Address","name":"dex","type":"uint256"},{"internalType":"Address","name":"dex2","type":"uint256"},{"internalType":"Address","name":"dex3","type":"uint256"}],"name":"unoswapTo3","outputs":[{"internalType":"uint256","name":"returnAmount","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"unpause","outputs":[],"stateMutability":"nonpayable","type":"function"},{"stateMutability":"payable","type":"receive"}])
  
  return {
    isSwap: true,
    dex: '1INCH_ROUTER',
    routerVersion: 'V6',
    method: methodName,
    slippage: slippageInfo,
    decodedData: {
      methodSelector,
      dataLength: inputData.length,
      decodingMethod: 'v6 binary handler'
    }
  };
}



/**
 * Enhanced decoder for 1inch V3 Router swap transactions with method 0x7c025200
 * This decoder handles the complex structure of V3 transactions based on real-world data
 * @param {String} methodSelector - Function signature (should be '0x7c025200')
 * @param {String} inputData - Transaction input data
 * @returns {Object} - Decoded transaction data with slippage info
 */
function decode1inchV3Transaction(methodSelector, inputData) {
  try {
    // Verify this is the V3 swap method
    if (methodSelector !== '0x7c025200') {
      return {
        isSwap: true,
        dex: '1INCH_ROUTER',
        routerVersion: 'V3',
        method: methodSelector,
        slippage: 'Not a recognized V3 swap method',
        error: 'Method selector does not match V3 swap'
      };
    }
    
    console.log('Processing 1inch V3 transaction with swap method');
    
    try {  
      // Extract source token (first address parameter after the initial offsets) - offset 10 + 32*3
      const srcTokenOffset = 10 + (3 * 64);
      const srcToken = '0x' + inputData.slice(srcTokenOffset, srcTokenOffset + 64).slice(24);
      
      // Extract destination token - offset 10 + 32*4
      const dstTokenOffset = 10 + (4 * 64);
      const dstToken = '0x' + inputData.slice(dstTokenOffset, dstTokenOffset + 64).slice(24);
      
      // Extract amount - offset 10 + 32*7
      const amountOffset = 10 + (7 * 64);
      const amountHex = '0x' + inputData.slice(amountOffset, amountOffset + 64);
      
      // Extract minReturnAmount - offset 10 + 32*8
      const minReturnOffset = 10 + (8 * 64);
      const minReturnHex = '0x' + inputData.slice(minReturnOffset, minReturnOffset + 64);
      
      // Calculate amount and minReturn as big integers
      let amount, minReturnAmount;
      try {
        amount = BigInt(amountHex).toString();
        minReturnAmount = BigInt(minReturnHex).toString();
      } catch (e) {
        amount = amountHex;
        minReturnAmount = minReturnHex;
      }
      
      // Estimate slippage if possible
      let slippageInfo;
      if (amount && minReturnAmount) {
        slippageInfo = `Min return: ${minReturnAmount}`;
      } else {
        slippageInfo = 'Complex V3 swap with embedded slippage protection';
      }
      
      return {
        isSwap: true,
        dex: '1INCH_ROUTER',
        routerVersion: 'V3',
        method: 'swap_complex',
        slippage: slippageInfo,
        decodedData: {
          extractionMethod: 'binary_pattern_matching',
          srcToken,
          dstToken,
          amount,
          minReturnAmount
        }
      };
    } catch (binaryError) {
      console.error(`Binary data extraction failed: ${binaryError.message}`);
      
      // Fall back to basic binary info
      return {
        isSwap: true,
        dex: '1INCH_ROUTER',
        routerVersion: 'V3',
        method: 'swap_complex',
        slippage: 'Binary fallback - complex data structure',
        decodedData: {
          methodSelector,
          dataLength: inputData.length,
          error: binaryError.message
        }
      };
    }
  } catch (error) {
    console.error(`Error in decode1inchV3Transaction: ${error.message}`);
    return {
      isSwap: true,
      dex: '1INCH_ROUTER',
      routerVersion: 'V3',
      method: 'swap',
      slippage: 'Unknown (decoding error)',
      error: error.message
    };
  }
}


/**
 * ABI-specific 1inch transaction decoder
 * Using the exact interface definitions from the AggregationRouterV5 ABI
 * @param {String} methodSelector - Function signature
 * @param {String} inputData - Transaction input data
 * @param {String} dexKey - The specific 1inch router version key
 * @returns {Object} - Decoded transaction data
 */
function decode1inchTransaction(methodSelector, inputData, dexKey) {
  // Extract router version for better error handling
  const routerVersion = dexKey.includes('_V') ? dexKey.split('_V')[1] : '';

  console.log(`Processing 1inch transaction with method ${methodSelector} and router version ${routerVersion}`);
  // Special case for V3 swap method 0x7c025200
  if (methodSelector === '0x7c025200') {
    console.log('Detected 1inch V3 swap method, using dedicated V3 decoder');
    return decode1inchV3Transaction(methodSelector, inputData);
  }
  try {
    // V6-specific handling - updated to use the new V6 method handler
    if (routerVersion === '6') {
      // These V6 methods use Address type (uint256) instead of address type
      // Our revised approach handles them with a dedicated V6 method handler
      const v6Methods = [
        '0x07ed2379', 
        '0x83800a8e', 
        '0xb68fb020',
        '0xcc713a04',
        '0xa76dfc3b',
        '0xc3cf8043'  // Another V6 method seen in logs
      ];
      
      if (v6Methods.includes(methodSelector)) {
        console.log(`Using V6 method handler for ${methodSelector}`);
        return handleV6Method(methodSelector, inputData);
      }
    }
    
    // Standard methods below - this is the existing code
    let methodName = null;
    let decodedData = null;
    let slippageInfo = "Unknown";
    let success = false;
    
    // Shared interface methods across all versions
    if (methodSelector === '0x12aa3caf') { // swap
      methodName = 'swap';
      
      // First try V5/V6 interface
      try {
        const swapV56Interface = new ethers.Interface([
          'function swap(address executor, tuple(address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)'
        ]);
        
        decodedData = swapV56Interface.decodeFunctionData('swap', inputData);
        console.log(`Successfully decoded ${methodName} with V5/V6 interface`);
        success = true;
        
        // Extract minReturnAmount if possible
        try {
          const desc = decodedData.desc || decodedData.args?.[1] || decodedData[1];
          if (desc && desc.minReturnAmount) {
            slippageInfo = `Min return: ${desc.minReturnAmount.toString()}`;
          }
        } catch (err) {
          slippageInfo = "Could not extract minimum return amount";
        }
      } catch (e) {
        // Try V4 interface
        try {
          const swapV4Interface = new ethers.Interface([
            'function swap(address caller, tuple(address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes data) payable returns (uint256, uint256)'
          ]);
          
          decodedData = swapV4Interface.decodeFunctionData('swap', inputData);
          console.log(`Successfully decoded ${methodName} with V4 interface`);
          success = true;
          
          // Extract minReturnAmount if possible
          try {
            const desc = decodedData.desc || decodedData.args?.[1] || decodedData[1];
            if (desc && desc.minReturnAmount) {
              slippageInfo = `Min return: ${desc.minReturnAmount.toString()}`;
            }
          } catch (err) {
            slippageInfo = "Could not extract minimum return amount";
          }
        } catch (e2) {
          // Try V3 interface
          try {
            const swapV3Interface = new ethers.Interface([
              'function swap(address caller, tuple(address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes data) payable returns (uint256, uint256, uint256)'
            ]);
            
            decodedData = swapV3Interface.decodeFunctionData('swap', inputData);
            console.log(`Successfully decoded ${methodName} with V3 interface`);
            success = true;
          } catch (e3) {
            // If all specific interfaces fail, try generic
            console.log(`Specific interfaces failed for swap, trying generic interface`);
          }
        }
      }
    } 
    // unoswap method (0x0502b1c5)
    else if (methodSelector === '0x0502b1c5') {
      methodName = 'unoswap';
      
      // Try V5/V6 interface first with uint256[] pools
      try {
        const unoswapInterface = new ethers.Interface([
          'function unoswap(address srcToken, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)'
        ]);
        
        decodedData = unoswapInterface.decodeFunctionData('unoswap', inputData);
        console.log(`Successfully decoded unoswap with V5/V6 interface`);
        success = true;
        
        // Extract minReturn
        if (decodedData.minReturn) {
          slippageInfo = `Min return: ${decodedData.minReturn.toString()}`;
        } else if (decodedData[2]) {
          slippageInfo = `Min return: ${decodedData[2].toString()}`;
        }
      } catch (e) {
        // Try with bytes32[] pools (V4/alt version)
        try {
          const unoswapAltInterface = new ethers.Interface([
            'function unoswap(address srcToken, uint256 amount, uint256 minReturn, bytes32[] pools) payable returns (uint256 returnAmount)'
          ]);
          
          decodedData = unoswapAltInterface.decodeFunctionData('unoswap', inputData);
          console.log(`Successfully decoded unoswap with bytes32[] pools interface`);
          success = true;
          
          if (decodedData.minReturn) {
            slippageInfo = `Min return: ${decodedData.minReturn.toString()}`;
          } else if (decodedData[2]) {
            slippageInfo = `Min return: ${decodedData[2].toString()}`;
          }
        } catch (e2) {
          // Try generic fallback
          console.log(`Specific unoswap interfaces failed, trying generic fallback`);
        }
      }
    }
    // unoswapTo method (0x2e95b6c8) - this is the one causing the most problems
    else if (methodSelector === '0x2e95b6c8') {
      methodName = 'unoswapTo';
      
      // Try multiple interfaces in sequence
      const unoswapToInterfaces = [
        // From actual V5/V6 ABI - note: Address type is uint256
        'function unoswapTo(uint256 to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)',
        // Alternative Address format as address
        'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
        // Another variation based on actual ABIs
        'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, bytes32[] pools) payable returns (uint256 returnAmount)',
        // Simplified version
        'function unoswapTo(address, address, uint256, uint256, uint256[]) payable returns (uint256)',
        // Most generic version
        'function unoswapTo(address, address, uint256, uint256, bytes) payable returns (uint256)'
      ];
      
      // Try each interface in turn
      for (const interfaceDefinition of unoswapToInterfaces) {
        try {
          const unoswapToInterface = new ethers.Interface([interfaceDefinition]);
          decodedData = unoswapToInterface.decodeFunctionData('unoswapTo', inputData);
          console.log(`Successfully decoded ${methodName} with interface: ${interfaceDefinition}`);
          success = true;
          
          // Try to extract minReturn
          try {
            if (decodedData.minReturn) {
              slippageInfo = `Min return: ${decodedData.minReturn.toString()}`;
            } else if (decodedData[3] && typeof decodedData[3] !== 'object') {
              slippageInfo = `Min return: ${decodedData[3].toString()}`;
            } else {
              slippageInfo = "Min return included in complex parameters";
            }
          } catch (err) {
            slippageInfo = "Complex parameter structure";
          }
          
          break; // Exit the loop if successful
        } catch (e) {
          // Continue to next interface
          if (interfaceDefinition === unoswapToInterfaces[unoswapToInterfaces.length - 1]) {
            console.log(`All unoswapTo interfaces failed, will use binary decoder`);
          }
        }
      }
    }
    // uniswapV3Swap method (0xe449022e)
    else if (methodSelector === '0xe449022e') {
      methodName = 'uniswapV3Swap';
      
      try {
        const uniV3SwapInterface = new ethers.Interface([
          'function uniswapV3Swap(uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)'
        ]);
        
        decodedData = uniV3SwapInterface.decodeFunctionData('uniswapV3Swap', inputData);
        console.log(`Successfully decoded ${methodName}`);
        success = true;
        
        // Extract minReturn
        if (decodedData.minReturn) {
          slippageInfo = `Min return: ${decodedData.minReturn.toString()}`;
        } else if (decodedData[1]) {
          slippageInfo = `Min return: ${decodedData[1].toString()}`;
        }
      } catch (e) {
        console.log(`Failed to decode uniswapV3Swap: ${e.message}`);
      }
    }
    // V3 swap method (0x7c025200)
    else if (methodSelector === '0x7c025200') {
      methodName = 'swap';
      
      try {
        // V3 interface specifically
        const swapV3Interface = new ethers.Interface([
          'function swap(address fromToken, address toToken, uint256 amount, uint256 minReturn, uint256[] distribution, uint256 flags) payable returns (uint256)'
        ]);
        
        decodedData = swapV3Interface.decodeFunctionData('swap', inputData);
        console.log(`Successfully decoded V3 swap`);
        success = true;
        
        // Extract minReturn
        if (decodedData.minReturn) {
          slippageInfo = `Min return: ${decodedData.minReturn.toString()}`;
        } else if (decodedData[3]) {
          slippageInfo = `Min return: ${decodedData[3].toString()}`;
        }
      } catch (e) {
        // Alternative V3 format
        try {
          const swapV3AltInterface = new ethers.Interface([
            'function swap(address, address, uint256, uint256, uint256[], uint256) payable returns (uint256)'
          ]);
          
          decodedData = swapV3AltInterface.decodeFunctionData('swap', inputData);
          console.log(`Successfully decoded V3 swap with alternative interface`);
          success = true;
        } catch (e2) {
          console.log(`Failed to decode V3 swap: ${e2.message}`);
        }
      }
    }
    // Alt swap method (0x9570eeee) - this one fails in your logs
    else if (methodSelector === '0x9570eeee') {
      methodName = 'alternativeSwap';
      
      // This method isn't explicitly in the ABIs, so use a generic bytes interface
      try {
        const altSwapInterface = new ethers.Interface([
          'function swapAlt(bytes calldata data) payable returns (uint256)'
        ]);
        
        try {
          decodedData = altSwapInterface.decodeFunctionData('swapAlt', inputData);
          console.log(`Successfully decoded alternative swap method`);
          success = true;
          slippageInfo = 'Embedded in calldata bytes';
        } catch (innerError) {
          // If direct parsing fails, just use binary fallback
          console.log(`Direct parsing failed for 0x9570eeee, using binary fallback`);
          return binaryFallback1inchDecoder(methodSelector, inputData, routerVersion);
        }
      } catch (e) {
        console.log(`Enhanced decoder failed for 0x9570eeee: ${e.message}`);
        return binaryFallback1inchDecoder(methodSelector, inputData, routerVersion);
      }
    }
    
    // If we couldn't decode with any specific method handler
    if (!success) {
      console.log(`Could not decode with specific method handler, using binary fallback`);
      return binaryFallback1inchDecoder(methodSelector, inputData, routerVersion);
    }
    
    // Return the decoded data
    return {
      isSwap: true,
      dex: '1INCH_ROUTER',
      routerVersion: routerVersion ? `V${routerVersion}` : '',
      method: methodName,
      slippage: slippageInfo,
      decodedData: JSON.parse(JSON.stringify(decodedData, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      ))
    };
  } catch (error) {
    console.error(`Error in decode1inchTransaction: ${error.message}`);
    
    // Fallback to binary decoding
    return binaryFallback1inchDecoder(methodSelector, inputData, routerVersion);
  }
}



/**
 * Decode Uniswap V4 transaction
 * @param {String} methodSelector - Function signature
 * @param {String} inputData - Transaction input data
 * @returns {Object} - Decoded transaction data with slippage info
 */
function decodeUniswapV4Transaction(methodSelector, inputData) {
  try {
    let uniswapV4Interface;
    
    // Create interface with both execute overloads from the ABI
    if (ethers.Interface) {
      uniswapV4Interface = new ethers.Interface([
        'function execute(bytes commands, bytes[] inputs) payable',
        'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
      ]);
    } else if (ethers.utils && ethers.utils.Interface) {
      uniswapV4Interface = new ethers.utils.Interface([
        'function execute(bytes commands, bytes[] inputs) payable',
        'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
      ]);
    } else {
      throw new Error("Ethers.js Interface not found - check ethers version");
    }
    
    let decodedData;
    let methodName;
    let hasDeadline = false;
    
    // Method selector for the execute functions
    // Note: These should be verified with the actual computed selectors
    const EXECUTE_WITH_DEADLINE = '0x3593564c'; // This is the one in your current code
    const EXECUTE_WITHOUT_DEADLINE = '0x4d5f327c'; // This should be verified
    
    switch (methodSelector) {
      case EXECUTE_WITH_DEADLINE:
        try {
          // Try to decode with the 3-parameter version (with deadline)
          decodedData = uniswapV4Interface.decodeFunctionData('execute(bytes,bytes[],uint256)', inputData);
          methodName = 'execute';
          hasDeadline = true;
        } catch (e) {
          console.warn(`Failed to decode as execute with deadline: ${e.message}`);
          // Fall back to 2-parameter version
          decodedData = uniswapV4Interface.decodeFunctionData('execute(bytes,bytes[])', inputData);
          methodName = 'execute';
          hasDeadline = false;
        }
        break;
        
      case EXECUTE_WITHOUT_DEADLINE:
        decodedData = uniswapV4Interface.decodeFunctionData('execute(bytes,bytes[])', inputData);
        methodName = 'execute';
        hasDeadline = false;
        break;
        
      default:
        return {
          isSwap: true,
          dex: 'UNISWAP_V4',
          method: methodSelector,
          slippage: 'Unknown Uniswap V4 method',
          input: inputData
        };
    }
    
    // Extract commands and inputs
    const commands = decodedData.commands || decodedData[0];
    const inputs = decodedData.inputs || decodedData[1];
    
    // Process the commands bytes to extract information about the swap
    let commandInfo = extractCommandInfo(commands);
    
    // Try to extract deadline if applicable
    let deadlineTimestamp = "N/A";
    
    if (hasDeadline) {
      let deadline = decodedData.deadline || decodedData[2];
      
      try {
        if (deadline) {
          if (typeof deadline.toNumber === 'function') {
            deadlineTimestamp = new Date(deadline.toNumber() * 1000).toISOString();
          } else {
            deadlineTimestamp = new Date(Number(deadline) * 1000).toISOString();
          }
        }
      } catch (e) {
        console.error("Error formatting deadline:", e);
        deadlineTimestamp = "Error parsing deadline";
      }
    }
    
    // Determine slippage info from command bytes if possible
    let slippageInfo = "Slippage encoded in command bytes";
    if (commandInfo.hasSlippage) {
      slippageInfo = `Slippage protection: ${commandInfo.slippageDescription}`;
    }
    
    return {
      isSwap: true,
      dex: 'UNISWAP_V4',
      method: methodName,
      slippage: slippageInfo,
      deadline: deadlineTimestamp,
      commandsDecoded: commandInfo,
      // Convert BigInt to strings for JSON serialization
      decodedData: JSON.parse(JSON.stringify(decodedData, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      ))
    };
  } catch (error) {
    console.error(`Error in decodeUniswapV4Transaction: ${error.message}`);
    return {
      isSwap: true,
      dex: 'UNISWAP_V4',
      method: getFunctionNameFromSelector(methodSelector),
      slippage: "Unknown (decoding error)",
      error: error.message,
      input: inputData
    };
  }
}

/**
 * Extract command information from Uniswap V4 command bytes
 * This is a placeholder function that should be implemented based on V4 documentation
 * @param {String} commandsHex - Hex string of command bytes
 * @returns {Object} - Information about the commands
 */
function extractCommandInfo(commandsHex) {
  // This is a placeholder - in a real implementation, you would decode the command bytes
  // based on Uniswap V4 documentation about command encoding
  
  try {
    // Convert hex to bytes if it's a string
    const commandBytes = typeof commandsHex === 'string' 
      ? commandsHex.startsWith('0x') ? commandsHex.slice(2) : commandsHex 
      : commandsHex.toString();
    
    // Basic analysis - in reality you'd need to understand V4's command format
    return {
      commandLength: commandBytes.length / 2, // Each byte is 2 hex chars
      hasSlippage: true, // Placeholder - would check actual commands
      slippageDescription: "Detected in command bytes (implementation needed)",
      // Add more detailed command parsing here based on V4 documentation
      commandFormat: "See Uniswap V4 documentation for command format details"
    };
  } catch (error) {
    console.error(`Error extracting command info: ${error.message}`);
    return {
      commandLength: 0,
      hasSlippage: false,
      error: error.message
    };
  }
}

// Update the getFunctionNameFromSelector function to include new methods
function getFunctionNameFromSelector(selector) {
  const selectorMap = {
    // Existing selectors
    [METHOD_SELECTORS.SWAP_EXACT_ETH_FOR_TOKENS]: 'swapExactETHForTokens',
    [METHOD_SELECTORS.SWAP_ETH_FOR_EXACT_TOKENS]: 'swapETHForExactTokens',
    [METHOD_SELECTORS.SWAP_EXACT_TOKENS_FOR_ETH]: 'swapExactTokensForETH',
    [METHOD_SELECTORS.SWAP_TOKENS_FOR_EXACT_ETH]: 'swapTokensForExactETH',
    [METHOD_SELECTORS.SWAP_EXACT_TOKENS_FOR_TOKENS]: 'swapExactTokensForTokens',
    [METHOD_SELECTORS.SWAP_TOKENS_FOR_EXACT_TOKENS]: 'swapTokensForExactTokens',
    [METHOD_SELECTORS.EXACT_INPUT_SINGLE]: 'exactInputSingle',
    [METHOD_SELECTORS.EXACT_OUTPUT_SINGLE]: 'exactOutputSingle',
    [METHOD_SELECTORS.EXACT_INPUT]: 'exactInput',
    [METHOD_SELECTORS.EXACT_OUTPUT]: 'exactOutput',
    
    // 1inch methods
    [METHOD_SELECTORS.ONEINCH_SWAP]: 'swap',
    [METHOD_SELECTORS.ONEINCH_UNOSWAP]: 'unoswap',
    [METHOD_SELECTORS.ONEINCH_SWAP_FROM_CURVE]: 'swapFromCurve',
    [METHOD_SELECTORS.ONEINCH_CLIPPER_SWAP]: 'clipperSwap',
    [METHOD_SELECTORS.ONEINCH_FILL_ORDER]: 'fillOrder',
    
    // Uniswap V4 methods
    [METHOD_SELECTORS.UNIV4_EXECUTE]: 'execute',
    [METHOD_SELECTORS.UNIV4_EXECUTE_META_TRANSACTION]: 'executeMetaTransaction',
  };
  
  return selectorMap[selector] || 'Unknown';
}

/**
 * Improved deadline extraction and validation for Balancer transactions
 * This function safely extracts and formats deadline timestamps
 * 
 * @param {any} deadline - The raw deadline value from transaction data
 * @returns {string} - Formatted deadline timestamp or error message
 */
function safeFormatDeadline(deadline) {
  if (!deadline) return "Not applicable";
  
  try {
    // Convert to number safely
    let deadlineNum;
    
    if (typeof deadline === 'bigint') {
      // Handle bigint directly
      if (deadline > BigInt(9007199254740991)) {
        return "Deadline too large for safe conversion";
      }
      deadlineNum = Number(deadline);
    } else if (typeof deadline.toNumber === 'function') {
      // Handle ethers.js BigNumber
      try {
        deadlineNum = deadline.toNumber();
      } catch (e) {
        // If toNumber fails (e.g., for values too large), use toString and parse
        const deadlineStr = deadline.toString();
        if (deadlineStr.length > 15) {
          return "Deadline value too large";
        }
        deadlineNum = parseInt(deadlineStr, 10);
      }
    } else if (typeof deadline === 'string') {
      // Handle string format
      deadlineNum = parseInt(deadline, 10);
    } else {
      // Default number handling
      deadlineNum = Number(deadline);
    }
    
    // Validate the number is reasonable
    if (isNaN(deadlineNum)) {
      return "Not a valid number";
    }
    
    // Verify the timestamp is within reasonable bounds
    // Unix timestamp should be between 2000-01-01 and 2100-01-01
    if (deadlineNum < 946684800 || deadlineNum > 4102444800) {
      return `Unusual deadline value: ${deadlineNum}`;
    }
    
    // JavaScript Date expects milliseconds
    if (deadlineNum < 10000000000) {  // If timestamp is in seconds
      deadlineNum *= 1000;
    }
    
    const deadlineDate = new Date(deadlineNum);
    
    // Final safety check
    if (!isNaN(deadlineDate.getTime())) {
      return deadlineDate.toISOString();
    } else {
      return "Invalid date value";
    }
  } catch (e) {
    console.error("Error formatting deadline:", e);
    return "Error parsing deadline: " + e.message;
  }
}

/**
 * Generic fallback decoder for any transaction
 * When specific decoders fail, this can at least identify and classify the transaction
 * @param {String} methodSelector - Function signature
 * @param {String} inputData - Transaction input data
 * @param {String} toAddress - The target address of the transaction
 * @returns {Object} - Basic decoded info
 */
function genericFallbackDecoder(methodSelector, inputData, toAddress) {
  // Normalize address
  const normalizedAddress = toAddress.toLowerCase();
  
  // Check if it's a known DEX address
  let matchedDex = null;
  for (const [dexName, dexAddress] of Object.entries(DEX_ADDRESSES)) {
    if (dexAddress.toLowerCase() === normalizedAddress) {
      matchedDex = dexName;
      break;
    }
  }
  
  if (!matchedDex) {
    return { isSwap: false };
  }
  
  // Try to identify the method
  const methodInfo = identifyMethodSelector(methodSelector);
  
  // For 1inch specifically, try to do more detailed analysis
  let slippageInfo = 'Unknown (using fallback decoder)';
  if (matchedDex.includes('ONEINCH')) {
    try {
      // Try to extract minReturn or similar slippage protection
      // This is crude but better than nothing
      const dataWithoutSelector = inputData.slice(10);
      
      // Look for common patterns in the binary data
      if (dataWithoutSelector.length > 200) {
        slippageInfo = 'Complex swap with embedded slippage protection';
      }
    } catch (e) {
      // Keep the default slippage info
    }
  }
    
  return {
    isSwap: true,
    dex: matchedDex,
    method: methodInfo.method || methodSelector,
    slippage: slippageInfo
  };
}


/**
 * Calculate slippage based on input and output amounts
 * @param {String} inputAmount - Maximum/exact input amount
 * @param {String} outputAmount - Minimum/exact output amount
 * @param {String} slippageType - Type of slippage (minimum output or maximum input)
 * @returns {String} - Slippage information
 */
function calculateSlippage(inputAmount, outputAmount, slippageType) {
  if (slippageType === 'minimum output' && inputAmount && outputAmount) {
    // In a real application, you would need market price data to calculate the exact slippage
    return `Slippage protection: ${outputAmount} minimum output for ${inputAmount} input`;
  } else if (slippageType === 'maximum input' && inputAmount) {
    return `Slippage protection: ${inputAmount} maximum input`;
  } else {
    return `Slippage type: ${slippageType}`;
  }
}

// Helper function to count transactions in a pool
function countTransactions(pool) {
  if (!pool) return 0;
  
  let count = 0;
  for (const address in pool) {
    count += Object.keys(pool[address]).length;
  }
  return count;
}

// Keep the process running with an infinite loop
async function main() {
  console.log('Starting mempool monitoring with ClickHouse integration');
  console.log('Starting polling every 2 seconds. Press Ctrl+C to stop.');
  
  // Add this to keep the process running
  process.stdin.resume();
  
  // Periodically analyze MEV opportunities
  setInterval(() => {
    try {
      analyzeMEVOpportunities(tx_pool);
    } catch (error) {
      console.error('Error in MEV analysis:', error);
    }
  }, 10000); // Every 10 seconds
  
  while (true) {
    try {
      await getTxPoolContent();
    } catch (error) {
      console.error('Error in polling cycle:', error);
    }
    
    // Wait for 2 seconds before next request
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Handle script termination
process.on('SIGINT', () => {
  console.log('\nStopping mempool monitoring...');
  
  // // Close SSH tunnel if it exists
  // if (sshTunnel) {
  //   console.log('Closing SSH tunnel');
  //   sshTunnel.close();
  // }
  
  process.exit();
});

// Start the main loop
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
