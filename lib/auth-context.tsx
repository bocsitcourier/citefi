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
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: boolean; userId?: number; twoFactorMethod?: string }>;
  verify2FA: (code: string, userId: number, method: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, fullName?: string, teamName?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
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
      // Store the short-lived challenge token so verify2FA can bind the 2FA
      // step to this completed password step. Not a secret auth token.
      if (response.challengeToken) {
        try { sessionStorage.setItem("auth_2fa_challenge", String(response.challengeToken)); } catch { /* SSR / locked */ }
      }
      return {
        requiresTwoFactor: true,
        userId: response.userId,
        twoFactorMethod: response.twoFactorMethod,
      };
    }

    setUser(response.user);
    return { requiresTwoFactor: false };
  };

  const verify2FA = async (code: string, userId: number, method: string) => {
    const challengeToken = (() => {
      try { return sessionStorage.getItem("auth_2fa_challenge"); } catch { return null; }
    })();

    const response = await apiRequest("/api/auth/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ userId, code, method, challengeToken }),
    });

    // Clear the one-time challenge token regardless of outcome
    try { sessionStorage.removeItem("auth_2fa_challenge"); } catch { /* ignore */ }

    setUser(response.user);
  };

  const signup = async (email: string, password: string, fullName?: string, teamName?: string) => {
    const response = await apiRequest("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, fullName, teamName }),
    });
    return response;
  };

  const logout = async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    }
    setUser(null);
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
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
