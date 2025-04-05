import React, { createContext, useState, useContext, useEffect } from 'react';

const UserContext = createContext();

export function UserProvider({ children }) {
  const [user, setUser] = useState({
    isVerified: false,
    nullifierHash: null
  });

  // Check for existing verification on component mount
  useEffect(() => {
    const verified = null;
    if (verified) {
      try {
        const parsedVerification = JSON.parse(verified);
        if (parsedVerification && parsedVerification.nullifier_hash) {
          setUser({
            isVerified: true,
            nullifierHash: parsedVerification.nullifier_hash
          });
        }
      } catch (e) {
        console.error("Error parsing stored verification:", e);
      }
    }
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}