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
        const cleanup = window.electron.onOpenSettings ?
            // We can reuse onOpenSettings event or just re-fetch periodically?
            // Actually, we should probably add a specific listener for settings changes if possible.
            // But for now, let's just re-apply when the component mounts or theme changes.
            // If the user changes settings, the modal will handle saving, we need to know when to re-apply.
            // Ideally, we'd have a 'settings-changed' event. 
            // For now, let's just depend on re-renders from theme changes, and maybe polling or specific event?
            // Let's add a simple event listener if the modal triggers one, or just rely on the fact 
            // that saving settings might not trigger a re-render here automatically without an event.
            // Let's assume we might need to add a listener mechanism later, but for now this handles load.
            null : null;

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
