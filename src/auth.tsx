import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { setToken } from "./api";

export type AuthState =
  | { kind: "none" }
  | { kind: "admin"; token: string; name: string }
  | {
      kind: "station";
      token: string;
      stationId: string;
      raceId: string;
      name: string;
      role: string;
      defaultTimingPointId: string | null;
    };

const STORAGE_KEY = "lopstid_auth";

function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { kind: "none" };
    return JSON.parse(raw) as AuthState;
  } catch {
    return { kind: "none" };
  }
}

interface AuthCtxValue {
  auth: AuthState;
  setAuth: (a: AuthState) => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthCtxValue>({
  auth: { kind: "none" },
  setAuth: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<AuthState>(loadAuth);

  function setAuth(a: AuthState) {
    setAuthState(a);
    if (a.kind === "none") {
      localStorage.removeItem(STORAGE_KEY);
      setToken(null);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
      setToken(a.token);
    }
  }

  function logout() {
    setAuth({ kind: "none" });
  }

  return (
    <AuthCtx.Provider value={{ auth, setAuth, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
