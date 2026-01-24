"use client";

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export default function ThemeManager() {
    const { theme, systemTheme } = useTheme();

    useEffect(() => {
        if (!window.electron) return;

        const applyTheme = async () => {
            const settings = await window.electron.getSettings();
            if (settings?.themePreferences) {
                const currentTheme = theme === 'system' ? systemTheme : theme;
                const prefs = settings.themePreferences[currentTheme === 'dark' ? 'dark' : 'light'];

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

        // Listen for changes


        // To make it live update, we can trust that saving settings via IPC might act as a signal if we had one.
        // For this implementation, we will add a secondary effect that listens to a custom event dispatched by SettingsModal
        // or simply exposes a reload function.

        const handleSettingsChange = () => applyTheme();
        window.addEventListener('theme-settings-changed', handleSettingsChange);

        return () => {
            window.removeEventListener('theme-settings-changed', handleSettingsChange);
        };

    }, [theme, systemTheme]);

    return null;
}
