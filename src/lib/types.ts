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
            getSettings: () => Promise<any>;
            saveSetting: (key: string, value: any) => Promise<any>;
            logout: () => Promise<boolean>;
            onImportDB: (callback: (filePath: string) => void) => () => void;
            onExportDB: (callback: () => void) => () => void;
            onLogoutRequest: (callback: () => void) => () => void;
            onOpenSettings: (callback: () => void) => () => void;
            onToggleTheme: (callback: () => void) => () => void;
            selectFolder: () => Promise<string | null>;
            storePassword: (pwd: string) => Promise<boolean>;
            getStoredPassword: () => Promise<string | null>;
        };
    }
}
