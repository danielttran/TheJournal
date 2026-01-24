"use client";

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export default function ThemeManager() {
    const { theme, systemTheme } = useTheme();

    useEffect(() => {
        const applyTheme = async () => {
            let settings: any = {};

            if (window.electron) {
                settings = await window.electron.getSettings();
            } else {
                try {
                    const saved = localStorage.getItem('app-settings');
                    settings = saved ? JSON.parse(saved) : {};
                } catch (e) { }
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
