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
    EntryType: 'Page' | 'Folder';
    SortOrder: number;
    Icon?: string;
    IsExpanded?: boolean;
    IsLocked?: boolean;
    IsFavorited?: boolean;
    Mood?: string | null;
    Tags?: string; // JSON array string, e.g. '["travel","work"]'
    CreatedDate?: string;
    ModifiedDate?: string;
    HtmlContent?: string;
    DocumentJson?: string | null;
    PreviewText?: string;
    children?: Entry[];
}

/** All view-action strings that the Electron menu can dispatch. */
export type ElectronViewAction =
    | 'search' | 'templates' | 'prompts' | 'focus' | 'split'
    | 'undo' | 'redo' | 'inline-code' | 'checklist'
    | 'highlight' | 'hr' | 'image-upload';

declare global {
    interface Window {
        electron: {
            // ── Invoke (renderer → main) ──────────────────────────────────────
            getSettings: () => Promise<Record<string, any>>;
            saveSetting: (key: string, value: any) => Promise<Record<string, any> | false>;
            logout: () => Promise<boolean>;
            selectFolder: () => Promise<string | null>;
            exportDatabase: () => Promise<boolean>;
            importDatabase: () => Promise<string | null>;
            storePassword: (pwd: string) => Promise<boolean>;
            getStoredPassword: () => Promise<string | null>;
            // ── Subscribe (main → renderer, returns unsubscribe fn) ───────────
            onToggleTheme: (callback: () => void) => () => void;
            onImportDB: (callback: (filePath: string) => void) => () => void;
            onExportDB: (callback: () => void) => () => void;
            onLogoutRequest: (callback: () => void) => () => void;
            onOpenSettings: (callback: () => void) => () => void;
            onViewAction: (callback: (action: ElectronViewAction) => void) => () => void;
        };
    }
}
