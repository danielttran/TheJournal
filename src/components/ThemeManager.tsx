"use client";

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export default function ThemeManager() {
    const { theme, systemTheme } = useTheme();

    useEffect(() => {
        const applyTheme = async () => {
            type ThemePref = { accentPrimary?: string; bgApp?: string; bgSidebar?: string };
            type Settings = { themePreferences?: { light?: ThemePref; dark?: ThemePref }; themePalette?: string };
            let settings: Settings = {};

            if (window.electron) {
                settings = (await window.electron.getSettings()) as Settings;
            } else {
                try {
                    const saved = localStorage.getItem('app-settings');
                    settings = saved ? JSON.parse(saved) : {};
                } catch (e) { }
            }

            const palette = settings?.themePalette;
            if (palette && palette !== 'default') {
                document.documentElement.setAttribute('data-theme', palette);
            } else {
                document.documentElement.removeAttribute('data-theme');
            }

            if (settings?.themePreferences) {
                const currentTheme = theme === 'system' ? systemTheme : theme;
                // Default to 'dark' if undefined for safety
                const activeTheme = currentTheme === 'dark' ? 'dark' : 'light';
                const prefs = settings.themePreferences[activeTheme];

                if (prefs) {
                    const root = document.documentElement;
                    if (prefs.accentPrimary) root.style.setProperty('--accent-primary', prefs.accentPrimary);
                    if (prefs.bgApp) root.style.setProperty('--bg-app', prefs.bgApp);
                    if (prefs.bgSidebar) root.style.setProperty('--bg-sidebar', prefs.bgSidebar);
                }
            }
        };

        // Initial application
        applyTheme();

        const handleSettingsChange = () => applyTheme();
        window.addEventListener('theme-settings-changed', handleSettingsChange);

        return () => {
            window.removeEventListener('theme-settings-changed', handleSettingsChange);
        };

    }, [theme, systemTheme]);

    return null;
}
