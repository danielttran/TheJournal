"use client";

import { Suspense } from "react";
import { login } from "@/app/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";

import { useEffect, useState, useRef, startTransition } from "react";

function LoginFormContent() {
    const [state, action, isPending] = useActionState(login, null);
    const searchParams = useSearchParams();
    const registered = searchParams.get("registered");
    const [rememberMe, setRememberMe] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    // Load settings on mount
    useEffect(() => {
        if (window.electron) {
            window.electron.getSettings().then((settings) => {
                if (settings && settings.rememberMe) {
                    setRememberMe(true);
                    const usernameInput = formRef.current?.querySelector('input[name="username"]') as HTMLInputElement;
                    const passwordInput = formRef.current?.querySelector('input[name="password"]') as HTMLInputElement;

                    if (usernameInput && passwordInput) {
                        usernameInput.value = settings.userName || "";
                        passwordInput.value = settings.savedPassword || "";

                        // Auto-fill only (no auto-submit)
                    }
                }
            });
        }
    }, []);

    // Save settings when login is successful (detected by redirect or lack of error)
    // However, since it's a server action redirect, we might need a better way.
    // For now, we save it on submit if rememberMe is checked.
    const handleSubmit = async (formData: FormData) => {
        if (window.electron) {
            const username = formData.get("username") as string;
            const password = formData.get("password") as string;

            // Always sync the userName setting as requested
            await window.electron.saveSetting("userName", username);

            if (rememberMe) {
                await window.electron.saveSetting("rememberMe", true);
                await window.electron.saveSetting("savedPassword", password);
            } else {
                await window.electron.saveSetting("rememberMe", false);
                await window.electron.saveSetting("savedPassword", "");
            }
        }
        startTransition(() => {
            action(formData);
        });
    };

    return (
        <main className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-gray-900 transition-colors duration-500">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-3xl" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/20 dark:bg-purple-600/10 rounded-full blur-3xl" />
            </div>

            {/* Theme Toggle Removed */}

            <div className="relative z-10 w-full max-w-md p-8 bg-white/70 dark:bg-black/40 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-3xl shadow-xl transition-all duration-300">
                <div className="flex flex-col items-center mb-8">
                    <div className="p-3 bg-blue-600 rounded-xl shadow-lg mb-4">
                        <NotebookPen className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
                        TheJournal
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        Sign in to continue your journey
                    </p>
                </div>

                <form ref={formRef} action={handleSubmit} className="space-y-6">
                    {registered && (
                        <div className="p-3 bg-green-100 border border-green-200 text-green-700 rounded-lg text-sm text-center font-medium">
                            Account created! Please sign in.
                        </div>
                    )}
                    {state?.message && (
                        <div className="p-3 bg-red-100 border border-red-200 text-red-700 rounded-lg text-sm text-center">
                            {state.message}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">Username</label>
                        <input
                            name="username"
                            type="text"
                            placeholder="johndoe"
                            required
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                        />
                        {state?.errors?.username && <p className="text-red-500 text-xs ml-1">{state.errors.username}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">Password</label>
                        <input
                            name="password"
                            type="password"
                            placeholder="••••••••"
                            required
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                        />
                        {state?.errors?.password && <p className="text-red-500 text-xs ml-1">{state.errors.password}</p>}
                    </div>

                    <div className="flex items-center space-x-2 ml-1">
                        <input
                            id="remember"
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="remember" className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                            Remember Password
                        </label>
                    </div>

                    <div className="space-y-4">
                        <button
                            type="submit"
                            disabled={isPending}
                            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transform hover:-translate-y-0.5 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? "Processing..." : "Sign In"}
                        </button>
                    </div>
                </form>

                <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    Don't have an account?{" "}
                    <Link href="/register" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        Create Account
                    </Link>
                </div>
            </div>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        }>
            <LoginFormContent />
        </Suspense>
    );
}
