import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "teacher" | "student" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName?: string | null;
  avatarUrl?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authInitialized: boolean;
  setUser: (user: AuthUser | null) => void;
  clearUser: () => void;
  setAuthInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      authInitialized: false,
      setUser: (user) =>
        set({
          user,
          isAuthenticated: Boolean(user),
        }),
      clearUser: () =>
        set({
          user: null,
          isAuthenticated: false,
        }),
      setAuthInitialized: (initialized) =>
        set({
          authInitialized: initialized,
        }),
    }),
    {
      name: "ai-teaching-auth",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
