import { createClient } from '@clickhouse/client-web';


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

// For development/testing, use mock data
// export const getMockData = () => {
//   // Top MEV opportunities
//   const topOpportunities = Array.from({ length: 10 }, (_, i) => ({
//     id: i,
//     hash: `0x${Math.random().toString(16).substring(2, 10)}...`,
//     dex: ['UNISWAP_V2', 'UNISWAP_V3', 'SUSHISWAP', 'PANCAKESWAP'][Math.floor(Math.random() * 4)],
//     method: ['swapExactETHForTokens', 'swapExactTokensForETH', 'exactInputSingle'][Math.floor(Math.random() * 3)],
//     slippagePercent: (Math.random() * 5 + 0.5).toFixed(2),
//     slippageCategory: ['MEDIUM', 'HIGH', 'VERY_HIGH'][Math.floor(Math.random() * 3)],
//     estimatedMEVValue: (Math.random() * 0.2).toFixed(4),
//     valueETH: (Math.random() * 10).toFixed(2),
//     gasPrice: (Math.random() * 100 + 20).toFixed(1),
//     poolType: Math.random() > 0.5 ? 'pending' : 'queued',
//     timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString()
//   }));

//   // Slippage distribution
//   const slippageDistribution = [
//     { category: 'VERY_LOW', count: Math.floor(Math.random() * 100) },
//     { category: 'LOW', count: Math.floor(Math.random() * 200) },
//     { category: 'MEDIUM', count: Math.floor(Math.random() * 300) },
//     { category: 'HIGH', count: Math.floor(Math.random() * 100) },
//     { category: 'VERY_HIGH', count: Math.floor(Math.random() * 50) }
//   ];

//   // DEX distribution
//   const dexDistribution = [
//     { name: 'UNISWAP_V2', value: Math.floor(Math.random() * 400) },
//     { name: 'UNISWAP_V3', value: Math.floor(Math.random() * 300) },
//     { name: 'SUSHISWAP', value: Math.floor(Math.random() * 200) },
//     { name: 'PANCAKESWAP', value: Math.floor(Math.random() * 100) }
//   ];

//   // MEV trends (hourly for the last 24 hours)
//   const mevTrends = Array.from({ length: 24 }, (_, i) => {
//     const date = new Date();
//     date.setHours(date.getHours() - i);
//     return {
//       hour: date.toISOString(),
//       highValueOpportunities: Math.floor(Math.random() * 20),
//       totalSwaps: Math.floor(Math.random() * 100 + 50),
//       opportunityPercent: (Math.random() * 20).toFixed(1),
//       totalMEVValue: (Math.random() * 2).toFixed(4)
//     };
//   }).reverse();

//   return {
//     topOpportunities,
//     slippageDistribution,
//     dexDistribution,
//     mevTrends
//   };
// };

// Direct ClickHouse queries - connect to your actual database
export const fetchTopMEVOpportunities = async (limit = 10) => {
  try {
    const query = `
      SELECT 
        hash,
        from_address as from,
        to_address as to,
        dex,
        method,
        toString(slippagePercentage) AS slippagePercent,  // Changed from slippagePercent
        slippageCategory,
        toString(slippageAbsolute) AS estimatedMEVValue, // Using slippageAbsolute as MEV value
        toString(valueInt / 1e18) AS valueETH,
        toString(gasPriceInt / 1e9) AS gasPrice,
        poolType,
        tokenOutSymbol,                                 // Added new field
        updatedAt as timestamp                          // Using updatedAt as timestamp
      FROM ethereum_transactions
      where slippageCategory IN ('HIGH', 'VERY_HIGH')   // Filter by category names
      ORDER BY slippageAbsolute DESC                    // Order by slippage value
      LIMIT ${limit}
    `;
    
    const resultSet = await clickhouse.query({
        query,
        format: 'JSONEachRow'
    });
    
    const result = await resultSet.json();
    return result;
  } catch (error) {
    console.error('Error fetching top MEV opportunities:', error);
    throw error;
  }
};

export const fetchSlippageDistribution = async () => {
  try {
    const query = `
      SELECT 
        slippageCategory AS category,
        count() AS count
      FROM ethereum_transactions
      WHERE isSwap = 1
      GROUP BY slippageCategory
      ORDER BY category
    `;
    
    // This query can remain the same assuming slippageCategory still exists
    const resultSet = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    });
    
    const result = await resultSet.json();
    return result;
  } catch (error) {
    console.error('Error fetching slippage distribution:', error);
    throw error;
  }
};

  export const fetchDexDistribution = async () => {
    try {
      const query = `
        SELECT 
          dex AS name,
          count() AS value
        FROM ethereum_transactions
        WHERE isSwap = 1 AND dex != ''
        GROUP BY dex
        ORDER BY value DESC
      `;
      
      console.log("Executing DEX distribution query:", query);
      const resultSet = await clickhouse.query({
        query,
        format: 'JSONEachRow'
      });
      
      const result = await resultSet.json();
      console.log("DEX distribution query result:", result);
      
      // If the result is empty, let's run a more general query to see what data is available
      if (!result || result.length === 0) {
        console.log("Empty DEX distribution result, checking available data...");
        const checkQuery = `
          SELECT 
            count() as total_swaps,
            countIf(dex != '') as has_dex
          FROM ethereum_transactions
          WHERE isSwap = 1
        `;
        
        const checkResultSet = await clickhouse.query({
          query: checkQuery,
          format: 'JSONEachRow'
        });
        
        console.log("Data check result:", await checkResultSet.json());
      }
      
      return result;
    } catch (error) {
      console.error('Error fetching DEX distribution:', error);
      throw error;
    }
  };

  export const fetchMEVTrends = async (days = 7) => {
    try {
      const query = `
        SELECT 
          toStartOfHour(fromUnixTimestamp(toInt64(updatedAt/1000))) AS hour,  
          countIf(mevPotential = 1) AS highValueOpportunities,
          count() AS totalSwaps,
          round(countIf(mevPotential = 1) / count() * 100, 2) AS opportunityPercent,
          toString(sum(slippageAbsolute) / 1e18) AS totalMEVValue  
        FROM ethereum_transactions
        WHERE 
          isSwap = 1
          AND updatedAt > toUInt64(toUnixTimestamp(now() - toIntervalDay(${days}))*1000)  
        GROUP BY hour
        ORDER BY hour
      `;
      
      const resultSet = await clickhouse.query({
        query,
        format: 'JSONEachRow'
      });
      
      // Process the result to ensure correct numeric values
      const result = await resultSet.json();
      
      // Convert string values back to numbers properly
      return result.map(item => ({
        ...item,
        totalMEVValue: parseFloat(item.totalMEVValue)
      }));
    } catch (error) {
      console.error('Error fetching MEV trends:', error);
      throw error;
    }
  };