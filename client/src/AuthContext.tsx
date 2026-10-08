import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'PHARMACIST' | 'STAFF';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: { id: string; name: UserRole } | null;
  isActive: boolean;
}

export interface ShopInfo {
  id: string;
  name: string;
  ownerName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  drugLicenseNumber?: string | null;
}

export interface SignupData {
  shopName: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  drugLicenseNumber?: string;
}

interface AuthContextType {
  user: User | null;
  token: string;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'pharmora-pos-token';
const USER_KEY = 'pharmora-pos-user';
const apiBase = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://pharmora-pos-api.onrender.com' : 'http://localhost:4000');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(true);

  // Restore and verify user session on mount
  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        if (active) {
          setUser(null);
          setToken('');
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(`${apiBase}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (!active) return;

        if (res.ok) {
          const payload = await res.json();
          if (payload.success && payload.user) {
            setUser(payload.user);
            setToken(storedToken);
            localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
          } else {
            clearSession();
          }
        } else {
          // Token expired or invalid
          clearSession();
        }
      } catch (err) {
        console.warn('Network error during session restore:', err);
        // If offline with saved user & token, keep offline shell access
        if (!navigator.onLine && user && storedToken) {
          // keep existing user
        } else {
          clearSession();
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      active = false;
    };
  }, []);

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken('');
    setUser(null);
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });

    const payload = await res.json();

    if (!res.ok || !payload.success) {
      throw new Error(payload.message || 'Login failed. Please check your credentials.');
    }

    const receivedToken = payload.token;
    const receivedUser = payload.user;

    localStorage.setItem(TOKEN_KEY, receivedToken);
    localStorage.setItem(USER_KEY, JSON.stringify(receivedUser));

    setToken(receivedToken);
    setUser(receivedUser);
  }

  async function signup(signupData: SignupData) {
    const res = await fetch(`${apiBase}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData),
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.success) {
      throw new Error(payload?.message || (res.status === 400 ? 'Signup failed. Please check your details.' : `Signup failed (${res.status || 'network error'}). Please try again.`));
    }

    const receivedToken = payload.token;
    const receivedUser = payload.user;

    localStorage.setItem(TOKEN_KEY, receivedToken);
    localStorage.setItem(USER_KEY, JSON.stringify(receivedUser));

    setToken(receivedToken);
    setUser(receivedUser);
  }

  function logout() {
    // Optionally fire logout to server (ignore result)
    if (token) {
      fetch(`${apiBase}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }

    clearSession();
  }

  async function refreshUser() {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload.success && payload.user) {
          setUser(payload.user);
          localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
        }
      } else if (res.status === 401) {
        clearSession();
      }
    } catch {
      // offline/network error
    }
  }

  const isAuthenticated = Boolean(token && user && user.isActive);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated,
        loading,
        login,
        signup,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
