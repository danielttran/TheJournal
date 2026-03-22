"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";
import { ToastProvider } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

        const unsubscribeToggleTheme = window.electron.onToggleTheme?.(() => {
            if (!isMounted) return;
            setTheme(currentTheme => {
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                if (window.electron) {
                    window.electron.saveSetting('theme', newTheme);
                }
                return newTheme;
            });
        });

        return () => {
            isMounted = false;
            unsubscribeToggleTheme?.();
        };
    }, [setTheme]);

    return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <ToastProvider>
                    <ThemeInitializer>
                        {children}
                    </ThemeInitializer>
                </ToastProvider>
            </ThemeProvider>
        </ErrorBoundary>
    );
}

