import TabBar from '@/components/journal/TabBar';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function JournalLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const userIdCookie = (await cookies()).get("userId");
    if (!userIdCookie) redirect("/login");
    const userId = userIdCookie.value;

    return (
        <div className="flex flex-col h-screen bg-[#111827] overflow-hidden">
            <TabBar userId={userId} />
            <div className="flex-1 overflow-hidden relative border-2 border-accent-primary">
                {children}
            </div>
        </div>
    );
}
