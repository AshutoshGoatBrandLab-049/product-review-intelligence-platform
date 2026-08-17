import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

/**
 * Phase 8 Step 1 — hand-rolled rather than a new dependency (no SSR to
 * worry about; this is a pure client-rendered SPA), consistent with the
 * "prefer existing primitives, avoid unnecessary dependencies" instruction.
 * A synchronous inline script in index.html applies the resolved class
 * before React ever mounts, so there is no flash of the wrong theme on
 * load — this provider only needs to keep that class in sync afterward.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme));

  useEffect(() => {
    const root = document.documentElement;
    const next = resolve(theme);
    root.classList.toggle("dark", next === "dark");
    root.style.colorScheme = next;
    setResolvedTheme(next);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const next = systemPrefersDark() ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.style.colorScheme = next;
      setResolvedTheme(next);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  const value = useMemo<ThemeState>(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
