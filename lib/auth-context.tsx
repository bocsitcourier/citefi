"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";

interface User {
  id: number;
  email: string;
  role: "admin" | "team_member";
  accountStatus: string;
  twoFactorEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: boolean; tempToken?: string }>;
  verify2FA: (code: string, tempToken: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    if (storedToken) {
      setToken(storedToken);
      fetchUser(storedToken);
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchUser = async (authToken: string) => {
    try {
      const response = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        // Clear both token AND user state on auth failure
        localStorage.removeItem("auth_token");
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      // Clear both token AND user state on error
      localStorage.removeItem("auth_token");
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const response = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (response.requiresTwoFactor) {
      return { requiresTwoFactor: true, tempToken: response.tempToken };
    }

    setToken(response.token);
    localStorage.setItem("auth_token", response.token);
    setUser(response.user);
    return { requiresTwoFactor: false };
  };

  const verify2FA = async (code: string, tempToken: string) => {
    const response = await apiRequest("/api/auth/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ code, tempToken }),
    });

    setToken(response.token);
    localStorage.setItem("auth_token", response.token);
    setUser(response.user);
  };

  const signup = async (email: string, password: string) => {
    const response = await apiRequest("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    // Do NOT auto-login - user must verify email and wait for admin approval
    // Return the response message to show to the user
    return response;
  };

  const logout = async () => {
    if (token) {
      try {
        await apiRequest("/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        console.error("Logout error:", error);
      }
    }

    setUser(null);
    setToken(null);
    localStorage.removeItem("auth_token");
  };

  const refreshUser = async () => {
    if (token) {
      await fetchUser(token);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        verify2FA,
        logout,
        signup,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
