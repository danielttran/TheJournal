import Link from "next/link";
import { NotebookPen } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-500">
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <div className="p-4 bg-blue-600 rounded-2xl shadow-xl">
            <NotebookPen className="w-12 h-12 text-white" />
          </div>
        </div>
        <h1 className="text-5xl font-bold tracking-tight">
          TheJournal
        </h1>
        <p className="text-xl text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Capture your thoughts, ideas, and memories in a beautiful, secure space.
        </p>

        <div className="pt-4">
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-white bg-blue-600 rounded-full hover:bg-blue-700 shadow-lg hover:shadow-blue-500/30 transition-all duration-300 transform hover:-translate-y-1"
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
}
