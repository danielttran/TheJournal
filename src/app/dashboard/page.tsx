import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Book, Notebook } from 'lucide-react';
import ImportCard from '@/components/dashboard/ImportCard';

async function getUser() {
    const userIdCookie = (await cookies()).get("userId");
    if (!userIdCookie) return null;
    return userIdCookie.value;
}

async function createInitialCategory(userId: string, type: 'Journal' | 'Notebook', name: string) {
    "use server";
    const stmt = db.prepare('INSERT INTO Category (UserID, Name, Type, IsPrivate) VALUES (?, ?, ?, ?)');
    const info = stmt.run(userId, name, type, 1);
    const categoryId = info.lastInsertRowid;

    redirect(`/journal/${categoryId}`);
}

export default async function DashboardPage() {
    const userId = await getUser();

    if (!userId) {
        redirect("/login");
    }

    const categories = db.prepare('SELECT * FROM Category WHERE UserID = ?').all(userId) as any[];

    if (categories.length > 0) {
        // Redirect to the first one for now, or show list
        // For keeping it simple as per request flow:
        redirect(`/journal/${categories[0].CategoryID}`);
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-8">
            <h1 className="text-3xl font-bold mb-8">Welcome to TheJournal</h1>
            <p className="text-gray-500 mb-12 text-lg">How would you like to start?</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
                {/* Journal Option */}
                <form action={async () => {
                    "use server";
                    await createInitialCategory(userId, 'Journal', 'My Journal');
                }}
                    className="group cursor-pointer">
                    <button type="submit" className="w-full h-full text-left">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 hover:shadow-2xl hover:border-blue-500 dark:hover:border-blue-500 transition-all duration-300 h-full">
                            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <Book className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h2 className="text-2xl font-semibold mb-2">Create a Journal</h2>
                            <p className="text-gray-500 dark:text-gray-400">
                                A daily log of your thoughts, ideas, and memories. Organized by date.
                            </p>
                        </div>
                    </button>
                </form>

                {/* Notebook Option */}
                <form action={async () => {
                    "use server";
                    await createInitialCategory(userId, 'Notebook', 'My Notebook');
                }}
                    className="group cursor-pointer">
                    <button type="submit" className="w-full h-full text-left">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 hover:shadow-2xl hover:border-purple-500 dark:hover:border-purple-500 transition-all duration-300 h-full">
                            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <Notebook className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                            </div>
                            <h2 className="text-2xl font-semibold mb-2">Create a Notebook</h2>
                            <p className="text-gray-500 dark:text-gray-400">
                                A collection of pages for projects, study notes, or planning.
                            </p>
                        </div>
                    </button>
                </form>

                {/* Import Option */}
                <ImportCard />
            </div>
        </div>
    );
}
