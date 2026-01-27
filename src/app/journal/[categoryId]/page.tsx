import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import JournalView from '@/components/journal/JournalView';

async function getCategory(categoryId: string, userId: string): Promise<any> {
    const category = db.prepare('SELECT * FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId) as any;
    return category;
}

export default async function JournalPage({ params, searchParams }: {
    params: Promise<{ categoryId: string }>,
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { categoryId } = await params;
    const sp = await searchParams;

    // Check Auth
    const userIdCookie = (await cookies()).get("userId");
    if (!userIdCookie) redirect("/login");
    const userId = userIdCookie.value;

    const category = await getCategory(categoryId, userId);
    if (!category) redirect("/dashboard");

    // Grid View Logic
    let gridEntries: any[] | null = null;
    let gridTitle = "";
    let dataUrl = "";

    if (sp.section) {
        const sectionId = typeof sp.section === 'string' ? sp.section : sp.section[0];
        // Fetch children of this section
        dataUrl = `/api/entry/children?parentId=${sectionId}`;
        gridEntries = db.prepare(`
            SELECT EntryID, Title, CreatedDate, Icon, PreviewText, EntryType
            FROM Entry 
            WHERE ParentEntryID = ?
            ORDER BY SortOrder ASC, CreatedDate DESC
        `).all(sectionId) as any[];

        // Get Section Title for header
        const section = db.prepare('SELECT Title FROM Entry WHERE EntryID = ?').get(sectionId) as any;
        gridTitle = section ? section.Title : "Section";

    } else if (sp.month) {
        const monthKey = typeof sp.month === 'string' ? sp.month : sp.month[0]; // "YYYY-MM"
        // Fetch entries for this month
        dataUrl = `/api/entry/dates?categoryId=${categoryId}&month=${monthKey}`;
        gridEntries = db.prepare(`
            SELECT EntryID, Title, CreatedDate, Icon, PreviewText
            FROM Entry 
            WHERE CategoryID = ? AND strftime('%Y-%m', CreatedDate) = ?
            ORDER BY CreatedDate ASC
        `).all(categoryId, monthKey) as any[];

        // Format title "January 2026"
        // We can do it in JS
        const [y, m] = monthKey.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1);
        gridTitle = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }

    return (
        <JournalView
            categoryId={categoryId}
            userId={userId}
            categoryName={category.Name}
            categoryType={category.Type}
            viewSettings={category.ViewSettings}
            gridEntries={gridEntries}
            gridTitle={gridTitle}
            dataUrl={dataUrl}
        />
    );
}

