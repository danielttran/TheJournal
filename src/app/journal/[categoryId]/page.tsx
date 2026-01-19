import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Sidebar from '@/components/journal/Sidebar';
import Editor from '@/components/journal/Editor';

async function getCategory(categoryId: string, userId: string): Promise<any> {
    const category = db.prepare('SELECT * FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId) as any;
    return category;
}

export default async function JournalPage({ params }: { params: Promise<{ categoryId: string }> }) {
    const { categoryId } = await params;

    // Check Auth
    const userIdCookie = (await cookies()).get("userId");
    if (!userIdCookie) redirect("/login");
    const userId = userIdCookie.value;

    const category = await getCategory(categoryId, userId);
    if (!category) redirect("/dashboard");

    return (
        <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
            <Sidebar categoryId={categoryId} userId={userId} title={category.Name} type={category.Type} />
            <main className="flex-1 flex flex-col h-full relative">
                <Editor categoryId={categoryId} userId={userId} />
            </main>
        </div>
    );
}
