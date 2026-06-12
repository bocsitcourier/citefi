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

// ---------------------------------------------------------------------------
// Token helpers — sessionStorage keeps the JWT alive across full-page reloads
// within the same browser tab. This is the fallback for iframe contexts where
// SameSite=None HttpOnly cookies may be blocked (e.g. Replit preview pane).
// ---------------------------------------------------------------------------
function saveToken(t: string) {
  try { sessionStorage.setItem("auth_token", t); } catch { /* SSR / locked */ }
}
function loadToken(): string | null {
  try { return sessionStorage.getItem("auth_token"); } catch { return null; }
}
function clearToken() {
  try { sessionStorage.removeItem("auth_token"); } catch { /* ignore */ }
  try { localStorage.removeItem("auth_token"); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const storedToken = loadToken();
      const headers: Record<string, string> = {};
      if (storedToken) headers["Authorization"] = `Bearer ${storedToken}`;

      const response = await fetch("/api/auth/me", {
        credentials: "include",
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        if (storedToken) setToken(storedToken);
      } else {
        setUser(null);
        setToken(null);
        clearToken();
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      setUser(null);
      setToken(null);
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

    // Persist token in sessionStorage so it survives full-page reloads
    // (needed when SameSite cookies are blocked in cross-site iframe contexts).
    if (response.token) {
      saveToken(response.token);
      setToken(response.token);
    }
    setUser(response.user);
    return { requiresTwoFactor: false };
  };

  const verify2FA = async (code: string, userId: number, method: string) => {
    const response = await apiRequest("/api/auth/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ userId, code, method }),
    });

    if (response.token) {
      saveToken(response.token);
      setToken(response.token);
    }
    setUser(response.user);
  };

  const signup = async (email: string, password: string) => {
    const response = await apiRequest("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return response;
  };

  const logout = async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    }
    clearToken();
    setUser(null);
    setToken(null);
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
