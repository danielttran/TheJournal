// @ts-ignore
import { login } from "@/app/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotebookPen } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
    return (
        <main className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-gray-900 transition-colors duration-500">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-3xl" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/20 dark:bg-purple-600/10 rounded-full blur-3xl" />
            </div>

            <div className="absolute top-6 right-6 z-20">
                <ThemeToggle />
            </div>

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

                <form action={login} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">Username</label>
                        <input
                            name="username"
                            type="text"
                            placeholder="johndoe"
                            required
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                        />
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
                    </div>

                    <button
                        type="submit"
                        className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transform hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                    >
                        Sign In
                    </button>
                </form>

                <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    Don't have an account?{" "}
                    <Link href="#" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        Create one
                    </Link>
                </div>
            </div>
        </main>
    );
}
