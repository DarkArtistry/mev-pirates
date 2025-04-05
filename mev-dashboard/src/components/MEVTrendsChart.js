import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const MEVTrendsChart = ({ data }) => {
  // Improved ETH value formatter
  const formatEthValue = (value) => {
    if (!value && value !== 0) return '0';
    
    // If the value is already small (less than 1), just format it nicely
    if (value < 1) {
      return parseFloat(value).toFixed(4);
    }
    
    // If value is extremely large, it might need Wei to ETH conversion
    if (value > 1000000) {
      // Convert from Wei to ETH (divide by 10^18)
      return (value / 1e18).toFixed(6);
    }
    
    return parseFloat(value).toFixed(4);
  };

  return (
    <div className="card">
      <h2>MEV Opportunities Over Time</h2>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="hour"
              tickFormatter={(time) => {
                const date = new Date(time);
                // On small screens, show only hour
                if (window.innerWidth < 768) {
                  return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
                }
                // On larger screens, show more details
                return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
              }}
            />
            <YAxis yAxisId="left" />
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              tickFormatter={(value) => formatEthValue(value)}
            />
            <Tooltip
              labelFormatter={(time) => new Date(time).toLocaleString()}
              formatter={(value, name) => {
                if (name === 'totalMEVValue') {
                  const formattedValue = formatEthValue(value);
                  return [`${formattedValue} GWEI`, 'Total MEV Value'];
                }
                if (name === 'opportunityPercent') return [`${value}%`, 'Opportunity %'];
                return [value, name];
              }}
            />
            <Legend />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="highValueOpportunities" 
              name="High-Value Opportunities"
              stroke="#8884d8" 
              activeDot={{ r: 8 }} 
            />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="totalSwaps" 
              name="Total Swaps"
              stroke="#82ca9d" 
            />
            <Line 
              yAxisId="right"
              type="monotone" 
              dataKey="totalMEVValue" 
              name="Total MEV Value"
              stroke="#ff7300" 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default MEVTrendsChart;