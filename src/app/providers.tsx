"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";

function ThemeInitializer({ children }: { children: React.ReactNode }) {
    const { setTheme } = useTheme();

    useEffect(() => {
        if (window.electron) {
            window.electron.getSettings().then((settings) => {
                if (settings && settings.theme) {
                    setTheme(settings.theme);
                }
            });

            // Listen for menu toggle
            window.electron.onToggleTheme && window.electron.onToggleTheme(() => {
                console.log('Theme toggle event received');
                setTheme(currentTheme => {
                    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                    console.log(`Toggling theme from ${currentTheme} to ${newTheme}`);
                    // Save to Electron settings
                    if (window.electron) {
                        window.electron.saveSetting('theme', newTheme);
                    }
                    return newTheme;
                });
            });
        }
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
