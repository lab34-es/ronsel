import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'ronsel:theme';

// What the user picked. "system" follows the operating system, the other two
// force one look no matter what the OS says.
export const THEME_MODES = ['light', 'dark', 'system'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

const readStoredMode = () => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) || '';
    return THEME_MODES.includes(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
};

const readSystemTheme = () =>
  (window.matchMedia && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');

const ThemeContext = createContext<any>(null);

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode);
  const [systemTheme, setSystemTheme] = useState(readSystemTheme);

  // The OS preference can change while the app is open (macOS auto dark mode,
  // for instance), and "system" has to follow it live.
  useEffect(() => {
    if (!window.matchMedia) { return undefined; }
    const query = window.matchMedia(DARK_QUERY);
    const handleChange = (event) => setSystemTheme(event.matches ? 'dark' : 'light');
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  // The theme actually painted: what every consumer (Monaco, Prism…) needs.
  const theme = mode === 'system' ? systemTheme : mode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setMode = useCallback((value) => {
    if (!THEME_MODES.includes(value)) { return; }
    setModeState(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Private browsing and friends: the theme still applies for this session.
    }
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, theme, systemTheme }),
    [mode, setMode, theme, systemTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
