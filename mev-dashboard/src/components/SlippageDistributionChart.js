import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const SlippageDistributionChart = ({ data }) => {
  // Define colors for each category
  const categoryColors = {
    'VERY_LOW': '#93c5fd',
    'LOW': '#60a5fa',
    'MEDIUM': '#3b82f6',
    'HIGH': '#f97316',
    'VERY_HIGH': '#ef4444',
    'UNKNOWN': '#9ca3af'
  };

  // Custom cell component to color bars by category
  const renderCustomizedBar = (props) => {
    const { x, y, width, height, payload } = props;
    const category = payload.category;
    const fill = categoryColors[category] || '#8884d8';

    return <rect x={x} y={y} width={width} height={height} fill={fill} radius={[4, 4, 0, 0]} />;
  };
  
  return (
    <div className="card">
      <h2>Slippage Distribution</h2>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis />
            <Tooltip 
              formatter={(value) => [`${value} transactions`, 'Count']}
              labelFormatter={(label) => `Category: ${label}`}
            />
            <Bar 
              dataKey="count" 
              name="Transaction Count"
              shape={renderCustomizedBar}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SlippageDistributionChart;