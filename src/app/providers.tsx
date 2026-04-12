"use client";

import { ThemeProvider } from "next-themes";
import { ToastProvider } from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import { LoadingProvider } from "@/contexts/LoadingContext";
import GlobalIPCManager from "@/components/GlobalIPCManager";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <LoadingProvider>
                    <ToastProvider>
                        <GlobalIPCManager />
                        {children}
                    </ToastProvider>
                </LoadingProvider>
            </ThemeProvider>
        </ErrorBoundary>
    );
}
