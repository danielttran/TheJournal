import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Book, Notebook } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import ImportCard from '@/components/dashboard/ImportCard';

async function getUser() {
    const userIdCookie = (await cookies()).get("userId");
    if (!userIdCookie) return null;
    return userIdCookie.value;
}

async function createInitialCategory(userId: string, type: 'Journal' | 'Notebook', name: string) {
    "use server";
    const stmt = db.prepare('INSERT INTO Category (UserID, Name, Type, IsPrivate) VALUES (?, ?, ?, ?)');
    const info = await stmt.run(userId, name, type, 1);
    const categoryId = info.lastInsertRowid;

    redirect(`/journal/${categoryId}`);
}

interface CategoryRow {
    CategoryID: number;
}

export default async function DashboardPage() {
    const userId = await getUser();

    if (!userId) {
        redirect("/login");
    }

    const categories = await db.prepare('SELECT CategoryID FROM Category WHERE UserID = ?').all<CategoryRow>(userId);

    if (categories.length > 0) {
        // Redirect to the first one for now, or show list
        // For keeping it simple as per request flow:
        redirect(`/journal/${categories[0].CategoryID}`);
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-bg-app text-text-primary p-8 relative">
            <div className="absolute top-4 right-4 group">
                <ThemeToggle />
            </div>

            <h1 className="text-3xl font-bold mb-8">Welcome to TheJournal</h1>
            <p className="text-text-secondary mb-12 text-lg">How would you like to start?</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
                {/* Journal Option */}
                <form action={async () => {
                    "use server";
                    await createInitialCategory(userId, 'Journal', 'My Journal');
                }}
                    className="group cursor-pointer">
                    <button type="submit" className="w-full h-full text-left">
                        <div className="bg-bg-card border border-border-primary rounded-3xl p-8 hover:shadow-2xl hover:border-accent-primary transition-all duration-300 h-full">
                            <div className="w-16 h-16 bg-accent-secondary/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <Book className="w-8 h-8 text-accent-primary" />
                            </div>
                            <h2 className="text-2xl font-semibold mb-2">Create a Journal</h2>
                            <p className="text-text-secondary">
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
                        <div className="bg-bg-card border border-border-primary rounded-3xl p-8 hover:shadow-2xl hover:border-accent-primary transition-all duration-300 h-full">
                            <div className="w-16 h-16 bg-accent-secondary/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <Notebook className="w-8 h-8 text-accent-primary" />
                            </div>
                            <h2 className="text-2xl font-semibold mb-2">Create a Notebook</h2>
                            <p className="text-text-secondary">
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
