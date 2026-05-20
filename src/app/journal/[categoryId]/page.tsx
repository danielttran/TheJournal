import { db, ensureUnlocked } from '@/lib/db';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import JournalView from '@/components/journal/JournalView';

interface CategoryRow {
    CategoryID: number;
    UserID: number;
    Name: string;
    Type: 'Journal' | 'Notebook';
    Color: string | null;
    Icon: string | null;
    IsPrivate: number;
    ViewSettings: string | null;
    SortOrder: number;
    IsSmartbook?: number | boolean;
}

interface GridEntryRow {
    EntryID: number;
    Title: string;
    CreatedDate?: string;
    Icon?: string | null;
    PreviewText?: string | null;
    EntryType?: 'Page' | 'Folder';
    SortOrder?: number;
    _monthKey?: string;
}

async function getCategory(categoryId: string, userId: string): Promise<CategoryRow | undefined> {
    return await db.prepare('SELECT * FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId) as CategoryRow | undefined;
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

    // Lazily unlock the DB — dev-mode workers may start without inherited unlock state
    await ensureUnlocked();

    const category = await getCategory(categoryId, userId);
    if (!category) redirect("/dashboard");

    // Grid View Logic
    let gridEntries: GridEntryRow[] | null = null;
    let gridTitle = "";
    let dataUrl = "";
    // Tells JournalView / EntryGrid how to handle click-navigation on grid cards.
    // 'section'  → notebook section children  (?section=id)
    // 'journal-month' → journal month entries (?date=YYYY-MM-DD)
    // 'journal-year'  → journal year view     (?month=YYYY-MM)
    let gridMode: 'section' | 'journal-month' | 'journal-year' = 'section';

    if (sp.folder) {
        const folderId = typeof sp.folder === 'string' ? sp.folder : sp.folder[0];
        dataUrl = `/api/entry/children?parentId=${folderId}`;
        gridMode = 'section';
        gridEntries = await db.prepare(`
            SELECT EntryID, Title, CreatedDate, Icon, PreviewText, EntryType
            FROM Entry
            WHERE ParentEntryID = ?
            ORDER BY SortOrder ASC, CreatedDate DESC
        `).all(folderId) as GridEntryRow[];

        const folder = await db.prepare('SELECT Title FROM Entry WHERE EntryID = ?').get(folderId) as { Title: string } | undefined;
        gridTitle = folder ? folder.Title : "Folder";

    } else if (sp.year) {
        const yearKey = typeof sp.year === 'string' ? sp.year : sp.year[0]; // "YYYY"
        dataUrl = `/api/entry/dates?categoryId=${categoryId}&year=${yearKey}`;
        gridMode = 'journal-year';

        const rows = await db.prepare(`
            SELECT strftime('%Y-%m', CreatedDate) AS monthKey,
                   COUNT(*) AS entryCount
            FROM Entry
            WHERE CategoryID = ? AND strftime('%Y', CreatedDate) = ?
            GROUP BY monthKey
            ORDER BY monthKey ASC
        `).all(categoryId, yearKey) as { monthKey: string; entryCount: number }[];

        gridEntries = rows.map(row => {
            const [y, m] = row.monthKey.split('-').map(Number);
            const monthName = new Date(y, m - 1).toLocaleString('default', { month: 'long' });
            return {
                EntryID: -(m),           // synthetic negative ID flags this as a virtual month card
                Title: monthName,
                CreatedDate: `${row.monthKey}-01`,
                PreviewText: `${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}`,
                EntryType: 'Folder',
                Icon: null,
                SortOrder: m,
                _monthKey: row.monthKey,
            };
        });
        gridTitle = yearKey;

    } else if (sp.month) {
        const monthKey = typeof sp.month === 'string' ? sp.month : sp.month[0]; // "YYYY-MM"
        dataUrl = `/api/entry/dates?categoryId=${categoryId}&month=${monthKey}`;
        gridMode = 'journal-month';
        gridEntries = await db.prepare(`
            SELECT EntryID, Title, CreatedDate, Icon, PreviewText
            FROM Entry
            WHERE CategoryID = ? AND strftime('%Y-%m', CreatedDate) = ?
            ORDER BY CreatedDate ASC
        `).all(categoryId, monthKey) as GridEntryRow[];

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
            viewSettings={category.ViewSettings ?? undefined}
            gridEntries={gridEntries}
            gridTitle={gridTitle}
            dataUrl={dataUrl}
            gridMode={gridMode}
            isSmartbook={!!category.IsSmartbook}
        />
    );
}
