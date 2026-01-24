export interface Category {
    CategoryID: number;
    Name: string;
    Type: 'Journal' | 'Notebook';
    Color?: string;
    SortOrder?: number;
    Icon?: string;
    ViewSettings?: string; // JSON string
    UserID?: number;
}

export interface Entry {
    EntryID: number;
    Title: string;
    ParentEntryID: number | null;
    EntryType: 'Page' | 'Section';
    SortOrder: number;
    Icon?: string;
    IsExpanded?: boolean;
    CreatedDate?: string;
    HtmlContent?: string;
    PreviewText?: string;
    children?: Entry[];
}

declare global {
    interface Window {
        electron: {
            saveFile: (content: string) => Promise<boolean>;
            getSettings: () => Promise<any>;
            saveSetting: (key: string, value: any) => Promise<any>;
            logout: () => Promise<boolean>;
            onToggleTheme: (callback: () => void) => void;
            onImportDB: (callback: (filePath: string) => void) => void;
            onExportDB: (callback: () => void) => void;
            onLogoutRequest: (callback: () => void) => void;
        };
    }
}
