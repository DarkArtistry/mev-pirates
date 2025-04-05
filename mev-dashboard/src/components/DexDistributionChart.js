import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const DexDistributionChart = ({ data }) => {
  // Add check for empty data
  if (!data || data.length === 0) {
    return (
      <div className="card">
        <h2>DEX Distribution</h2>
        <div className="chart-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <p>No DEX data available. Check if there are swap transactions with DEX information.</p>
        </div>
      </div>
    );
  }

  console.log("dex distribution data: \n", data);

  return (
    <div className="card">
      <h2>DEX Distribution</h2>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
            >
                {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
            </Pie>

            <Tooltip formatter={(value) => [`${value} transactions`, 'Count']} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DexDistributionChart;