import React from 'react';
import Dashboard from './pages/Dashboard';
import './index.css';
import MiniKitProvider from './components/MiniKitProvider';
import { UserProvider } from './context/UserContext';

function App() {
  return (
    <MiniKitProvider>
      <UserProvider>
        <div className="App">
          <Dashboard />
        </div>
      </UserProvider>
    </MiniKitProvider>
  );
}

export default App;