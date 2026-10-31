import {createContext, useCallback, useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {ConfigProvider} from 'antd';
import {lightTheme, darkTheme, themeColors} from 'common-ui-theme';
import type {ThemeColor} from 'common-ui-theme';

export type ThemeMode = 'light' | 'dark';
export type {ThemeColor};

export const THEME_MODE_KEY = 'theme-mode';
export const THEME_COLOR_KEY = 'theme-color';

const COLOR_LABELS: Record<ThemeColor, string> = {
    'blue-theme': 'Blue',
    'green-theme': 'Green',
    'orange-theme': 'Orange',
    'rose-theme': 'Rose',
    'violet-theme': 'Violet',
    'sky-theme': 'Sky',
};

const themeOptions = themeColors.map((value) => ({
    label: COLOR_LABELS[value],
    value,
}));

export interface ThemeContextValue {
    mode: ThemeMode;
    color: ThemeColor;
    toggleMode: () => void;
    setMode: (mode: ThemeMode) => void;
    changeColor: (color: ThemeColor) => void;
    themeOptions: typeof themeOptions;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const readStoredMode = (): ThemeMode | null => {
    const saved = localStorage.getItem(THEME_MODE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
};

const getSystemMode = (): ThemeMode =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const getInitialColor = (): ThemeColor => {
    const saved = localStorage.getItem(THEME_COLOR_KEY);
    return themeColors.includes(saved as ThemeColor)
        ? (saved as ThemeColor)
        : 'blue-theme';
};

export function ThemeProvider({children}: { children: ReactNode }) {
    const [mode, setModeState] = useState<ThemeMode>(
        () => readStoredMode() ?? getSystemMode(),
    );
    // Only a deliberate choice is persisted; otherwise we keep following the OS.
    const [isModeExplicit, setIsModeExplicit] = useState(
        () => readStoredMode() !== null,
    );
    const [color, setColor] = useState<ThemeColor>(getInitialColor);

    const setMode = useCallback((next: ThemeMode) => {
        setIsModeExplicit(true);
        setModeState(next);
    }, []);

    const toggleMode = useCallback(() => {
        setIsModeExplicit(true);
        setModeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
    }, []);

    const changeColor = useCallback((value: ThemeColor) => setColor(value), []);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', mode === 'dark');
        if (isModeExplicit) localStorage.setItem(THEME_MODE_KEY, mode);
    }, [mode, isModeExplicit]);

    useEffect(() => {
        const root = document.documentElement;

        root.classList.remove(...themeColors);
        root.classList.add(color);
        localStorage.setItem(THEME_COLOR_KEY, color);
    }, [color]);

    useEffect(() => {
        if (isModeExplicit) return;

        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (event: MediaQueryListEvent) =>
            setModeState(event.matches ? 'dark' : 'light');

        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [isModeExplicit]);

    const value = useMemo<ThemeContextValue>(
        () => ({mode, color, toggleMode, setMode, changeColor, themeOptions}),
        [mode, color, toggleMode, setMode, changeColor],
    );

    const antdTheme = useMemo(
        () => (mode === 'dark' ? darkTheme(color) : lightTheme(color)),
        [mode, color],
    );

    return (
        <ThemeContext.Provider value={value}>
            <ConfigProvider theme={antdTheme}>{children}</ConfigProvider>
        </ThemeContext.Provider>
    );
}
