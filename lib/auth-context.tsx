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
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: boolean; userId?: number; twoFactorMethod?: string }>;
  verify2FA: (code: string, userId: number, method: string) => Promise<void>;
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
    // Auth lives in an HttpOnly cookie sent automatically — just ask the server who we are.
    // Clear any stale token left in localStorage by older builds so legacy pages stop
    // sending a "Bearer <stale>" header that would override the fresh cookie.
    try {
      localStorage.removeItem("auth_token");
    } catch {
      // ignore (SSR / disabled storage)
    }
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
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
      return {
        requiresTwoFactor: true,
        userId: response.userId,
        twoFactorMethod: response.twoFactorMethod,
      };
    }

    // Token is now stored in an HttpOnly cookie by the server; we only keep user state.
    setUser(response.user);
    return { requiresTwoFactor: false };
  };

  const verify2FA = async (code: string, userId: number, method: string) => {
    const response = await apiRequest("/api/auth/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ userId, code, method }),
    });

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
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    }

    try {
      localStorage.removeItem("auth_token");
    } catch {
      // ignore
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
