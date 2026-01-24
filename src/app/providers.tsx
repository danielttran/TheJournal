"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";

function ThemeInitializer({ children }: { children: React.ReactNode }) {
    const { setTheme } = useTheme();

    useEffect(() => {
        if (!window.electron) return;

        let isMounted = true;

        window.electron.getSettings().then((settings) => {
            if (!isMounted) return;
            if (settings && settings.theme) {
                setTheme(settings.theme);
            }
        });

        // Listen for menu toggle - use mounted flag since IPC listeners can't be removed
        if (window.electron.onToggleTheme) {
            window.electron.onToggleTheme(() => {
                if (!isMounted) return;
                setTheme(currentTheme => {
                    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                    if (window.electron) {
                        window.electron.saveSetting('theme', newTheme);
                    }
                    return newTheme;
                });
            });
        }

        return () => {
            isMounted = false;
        };
    }, [setTheme]);

    return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <ThemeInitializer>
                {children}
            </ThemeInitializer>
        </ThemeProvider>
    );
}
