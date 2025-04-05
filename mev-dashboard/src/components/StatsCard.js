import React from 'react';

const StatsCard = ({ title, value, subtitle, color }) => {
  return (
    <div className="card stats-card">
      <span className="stats-title">{title}</span>
      <span className={`stats-value ${color}`}>{value}</span>
      {subtitle && <span className="stats-subtitle">{subtitle}</span>}
    </div>
  );
};

export default StatsCard;