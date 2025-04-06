import React from 'react';
import Dashboard from './pages/Dashboard';
import './index.css';
import MiniKitProvider from './components/MiniKitProvider';
import { UserProvider } from './context/UserContext';

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCgULuytt0WmsbogbxhouiCyNgwXio7AuY",
  authDomain: "mev-pirates.firebaseapp.com",
  projectId: "mev-pirates",
  storageBucket: "mev-pirates.firebasestorage.app",
  messagingSenderId: "818285804062",
  appId: "1:818285804062:web:9b09c546a75d9bbcb7cc0f",
  measurementId: "G-CJM4K0TYNJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

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