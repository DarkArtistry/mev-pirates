import React, { useState, useEffect } from 'react';
import { 
  fetchTopMEVOpportunities,
  fetchSlippageDistribution,
  fetchDexDistribution,
  fetchMEVTrends
} from '../api/mevApi';
import StatsCard from '../components/StatsCard';
import MEVOpportunitiesTable from '../components/MEVOpportunitiesTable';
import SlippageDistributionChart from '../components/SlippageDistributionChart';
import DexDistributionChart from '../components/DexDistributionChart';
import MEVTrendsChart from '../components/MEVTrendsChart';
import { IDKitWidget, VerificationLevel } from '@worldcoin/idkit';
import { useUser } from '../context/UserContext';

const Dashboard = () => {
  const [data, setData] = useState({
    topOpportunities: [],
    slippageDistribution: [],
    dexDistribution: [],
    mevTrends: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const { user, setUser } = useUser();

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch all data from ClickHouse
        const [
          topOpportunities,
          slippageDistribution,
          dexDistribution,
          mevTrends
        ] = await Promise.all([
          fetchTopMEVOpportunities(20), // Get top 20 opportunities
          fetchSlippageDistribution(),
          fetchDexDistribution(),
          fetchMEVTrends(1) // Get data for the last day
        ]);
        
        setData({
          topOpportunities,
          slippageDistribution,
          dexDistribution,
          mevTrends
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        setError('Failed to fetch data from ClickHouse. Please check your connection settings.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Set up auto-refresh
    const intervalId = setInterval(fetchData, refreshInterval * 1000);
    
    // Clean up
    return () => clearInterval(intervalId);
  }, [refreshInterval]);

  // WorldCoin verification handlers
  const verifyProof = async (proof) => {
    console.log("Proof: ", proof);
    localStorage.setItem('worldcoin_verified', JSON.stringify(proof));
    setUser({
      isVerified: true,
      nullifierHash: proof.nullifier_hash
    });
  };

  const onSuccess = () => {
    console.log("Verification successful!");
  };

  // Calculate stats
  const stats = {
    totalOpportunities: data.topOpportunities.length,
    highValueOpportunities: data.topOpportunities.filter(tx => 
      tx.slippageCategory === 'HIGH' || tx.slippageCategory === 'VERY_HIGH'
    ).length,
    totalMEVValue: data.topOpportunities.reduce(
      (sum, tx) => sum + parseFloat(tx.estimatedMEVValue || tx.slippageAbsolute), 0
    ).toFixed(4),
    averageSlippage: data.topOpportunities.length > 0 ? 
      (data.topOpportunities.reduce(
        (sum, tx) => sum + parseFloat(tx.slippagePercent || tx.slippagePercentage), 0
      ) / data.topOpportunities.length).toFixed(2) : '0'
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading dashboard data from ClickHouse...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <div style={{ color: 'red', marginBottom: '20px' }}>{error}</div>
        <button 
          onClick={() => window.location.reload()}
          style={{ padding: '8px 16px', background: '#4a6cf7', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="container">
      {/* WorldCoin verification banner */}
      <div className="card" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {!user.isVerified ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>Verify you're human to unlock MEV API access:</span>
            <IDKitWidget
              app_id="app_2f0191430aefca6225797dbc177fbe33"
              action="verify_user"
              verification_level={VerificationLevel.Orb}
              handleVerify={verifyProof}
              onSuccess={onSuccess}>
              {({ open }) => (
                <button
                  onClick={open}
                  style={{ 
                    padding: '8px 12px',
                    background: '#4a6cf7',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold'
                  }}
                >
                  Verify with World ID
                </button>
              )}
            </IDKitWidget>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ 
                color: 'green', 
                marginRight: '8px',
                fontSize: '18px' 
              }}>✓</span> 
              Verified human
            </span>
            <button
              disabled={true}
              style={{ 
                padding: '8px 12px',
                background: '#dddddd',
                color: '#666666',
                border: 'none',
                borderRadius: '4px',
                cursor: 'not-allowed',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
            >
              MEV API Access (Coming Soon)
            </button>
          </div>
        )}
      </div>

      <header className="header">
        <h1>MEV Opportunity Dashboard</h1>
        <p>
          Real-time monitoring of MEV opportunities in Ethereum mempool
        </p>
        <div className="header-controls">
          <div className="control-group">
            <span style={{ marginRight: '8px' }}>Auto-refresh:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>1m</option>
              <option value={300}>5m</option>
            </select>
          </div>
          <div className="refresh-time">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-4">
        <StatsCard
          title="Total Transactions"
          value={stats.totalOpportunities}
          subtitle="Past 24 hours"
          color="text-primary"
        />
        <StatsCard
          title="High-Value Opportunities"
          value={stats.highValueOpportunities}
          subtitle="High or Very High slippage"
          color="text-danger"
        />
        <StatsCard
          title="Total MEV Value"
          value={`${stats.totalMEVValue} GWEI`}
          subtitle="Estimated extractable value"
          color="text-success"
        />
        <StatsCard
          title="Average Slippage"
          value={`${stats.averageSlippage}%`}
          subtitle="Across all transactions"
          color="text-warning"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-2">
        <SlippageDistributionChart data={data.slippageDistribution} />
        <DexDistributionChart data={data.dexDistribution.map((eachData) => { return { 
            name: eachData.name, value: parseInt(eachData.value) 
        }} )} />
      </div>
      
      {/* Trends Chart */}
      <MEVTrendsChart data={data.mevTrends} />

      {/* Opportunities Table */}
      <div className="card">
        <h2>Top MEV Opportunities</h2>
        <MEVOpportunitiesTable opportunities={data.topOpportunities} />
      </div>

      <footer className="footer">
        <p>
          This dashboard visualizes potential MEV opportunities based on slippage analysis.
          Data is refreshed automatically from ClickHouse.
        </p>
        {user.isVerified && (
          <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
            Authenticated with World ID: {user.nullifierHash.substring(0, 10)}...
          </p>
        )}
      </footer>
    </div>
  );
};

export default Dashboard;