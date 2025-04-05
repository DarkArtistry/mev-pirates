import React from 'react';

const MEVOpportunitiesTable = ({ opportunities }) => {
  if (!opportunities || opportunities.length === 0) {
    return <div className="text-center">No opportunities found</div>;
  }

  const getBadgeClass = (category) => {
    switch (category) {
      case 'VERY_HIGH':
        return 'badge badge-red';
      case 'HIGH':
        return 'badge badge-orange';
      case 'MEDIUM':
        return 'badge badge-green';
      default:
        return 'badge badge-blue';
    }
  };

  const getPoolTypeBadgeClass = (poolType) => {
    return poolType === 'pending' ? 'badge badge-blue' : 'badge badge-purple';
  };

  // Helper function to format date properly
  const formatTime = (timeValue) => {
    try {
      // If it's a timestamp string with milliseconds (big number)
      if (typeof timeValue === 'number' || (typeof timeValue === 'string' && !isNaN(timeValue) && timeValue.length > 10)) {
        return new Date(Number(timeValue)).toLocaleTimeString();
      }
      
      // If it's a date string like "2025-04-05 16:33:33"
      if (typeof timeValue === 'string' && timeValue.includes('-')) {
        return new Date(timeValue).toLocaleTimeString();
      }
      
      // Default fallback
      return new Date().toLocaleTimeString();
    } catch (e) {
      console.error("Date parsing error:", e, timeValue);
      return "N/A";
    }
  };

  return (
    <div className="table-responsive">
      <table>
        <thead>
          <tr>
            <th>Hash</th>
            <th className="hide-sm">DEX</th>
            <th>Token</th>
            <th>Slippage</th>
            <th>MEV Value</th>
            <th className="hide-md">Value (ETH)</th>
            <th className="hide-md">Pool Type</th>
            <th className="hide-sm">Time</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((tx, index) => (
            <tr key={tx.hash || index}>
              <td className="text-primary hash-cell">{tx.hash.substring(0, 8)}...</td>
              <td className="hide-sm">{tx.dex}</td>
              <td>{tx.tokenOutSymbol || '-'}</td>
              <td>
                <span className={getBadgeClass(tx.slippageCategory)}>
                  {tx.slippagePercent || tx.slippagePercentage}%
                </span>
              </td>
              <td className="text-success">{tx.estimatedMEVValue || tx.slippageAbsolute}</td>
              <td className="hide-md">{tx.valueETH}</td>
              <td className="hide-md">
                <span className={getPoolTypeBadgeClass(tx.poolType)}>
                  {tx.poolType}
                </span>
              </td>
              <td className="hide-sm">{formatTime(tx.timestamp || tx.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MEVOpportunitiesTable;