import TabBar from '@/components/journal/TabBar';
import MenuBar from '@/components/journal/MenuBar';
import ReminderTicker from '@/components/journal/ReminderTicker';
import LockGate from '@/components/journal/LockGate';
import CommandDispatcher from '@/components/journal/CommandDispatcher';
import EntryPrintBridge from '@/components/journal/EntryPrintBridge';
import ActionDebugLogger from '@/components/journal/ActionDebugLogger';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';

export default async function JournalLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const verifiedId = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (verifiedId === null) redirect("/login");
    const userId = String(verifiedId);

    return (
        <div className="flex flex-col h-screen bg-[#111827] overflow-hidden">
            <MenuBar />
            <TabBar userId={userId} />
            <div className="flex-1 overflow-hidden relative border-2 border-accent-primary">
                {children}
            </div>
            <ReminderTicker />
            <LockGate />
            <CommandDispatcher />
            <EntryPrintBridge />
            <ActionDebugLogger />
        </div>
    );
}
