"use client";

import { useEffect, useState } from 'react';
import { X, Folder } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useToast } from './Toast';
import KeybindingsSection from './KeybindingsSection';
import PluginsSection from './PluginsSection';
import {
    TOOLBAR_GROUPS, loadToolbarConfig, saveToolbarConfig, toggleGroup, isGroupVisible,
} from '@/lib/toolbarConfig';
import { J8_MENUS } from '@/lib/menuSpec';
import { listMenuItems } from '@/lib/menuCustomization';
import { loadMenuHidden, saveMenuHidden } from '@/lib/menuCustomConfig';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Settings {
    backupPath: string;
    autoBackupOnClose: boolean;
    backupFrequency: number;
    retentionCount: number;
    themePreferences?: ThemePreferences;
    themePalette?: string;
    defaultFontSize: number;
    idleLockMinutes?: number;
    lockOnMinimize?: boolean;
    minimizeToTray?: boolean;
}

export const THEME_PALETTES = [
    { id: 'default', label: 'Default' },
    { id: 'sepia', label: 'Sepia (light)' },
    { id: 'ocean', label: 'Ocean (light)' },
    { id: 'forest', label: 'Forest (light)' },
    { id: 'midnight', label: 'Midnight (dark)' },
    { id: 'dracula', label: 'Dracula (dark)' },
];

type ThemeMode = 'light' | 'dark';
type ThemePreferences = Partial<Record<ThemeMode, Record<string, string>>>;

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { showToast } = useToast();
    const [settings, setSettings] = useState<Settings>({
        backupPath: '',
        autoBackupOnClose: false,
        backupFrequency: 3,
        retentionCount: 3,
        defaultFontSize: 14,
        idleLockMinutes: 0,
        lockOnMinimize: false,
        minimizeToTray: false,
        themePreferences: {},
    });
    const [loading, setLoading] = useState(true);
    const [isElectron, setIsElectron] = useState(false);

    useEscapeToClose(onClose, isOpen);

    useEffect(() => {
        // Detect Electron environment safely on mount
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
        const isEl = userAgent.includes(' electron/') || !!window.electron;
        setIsElectron(isEl);
    }, []); // Keep dependency array stable []

    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        setLoading(true);

        const loadSettings = async () => {
            try {
                let saved: Partial<Settings> = {};
                if (window.electron) {
                    saved = await window.electron.getSettings();
                } else {
                    const savedStr = localStorage.getItem('app-settings');
                    saved = savedStr ? JSON.parse(savedStr) : {};
                }

                if (!cancelled) {
                    setSettings({
                        backupPath: saved.backupPath || '',
                        autoBackupOnClose: saved.autoBackupOnClose || false,
                        backupFrequency: saved.backupFrequency || 3,
                        retentionCount: saved.retentionCount || 3,
                        themePreferences: saved.themePreferences || {},
                        themePalette: saved.themePalette || 'default',
                        defaultFontSize: saved.defaultFontSize || 14,
                        idleLockMinutes: Number(saved.idleLockMinutes) || 0,
                        lockOnMinimize: !!saved.lockOnMinimize,
                        minimizeToTray: !!saved.minimizeToTray,
                    });
                }
            } catch (error) {
                console.error('Failed to load settings:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadSettings();

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const handleSave = async (key: keyof Settings, value: Settings[keyof Settings]) => {
        // Update local state immediately via functional update to prevent race conditions
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            
            // Persist the updated state to storage
            if (window.electron) {
                window.electron.saveSetting(key as string, value);
            } else {
                localStorage.setItem('app-settings', JSON.stringify(next));
            }
            
            return next;
        });

        // Dispatch events for components that don't use the shared state
        if (key === 'themePreferences') {
            window.dispatchEvent(new Event('theme-settings-changed'));
        }
        if (key === 'defaultFontSize') {
            window.dispatchEvent(new CustomEvent('font-size-changed', { detail: value }));
        }
        if (key === 'themePalette') {
            window.dispatchEvent(new Event('theme-settings-changed'));
        }
        if (key === 'idleLockMinutes' || key === 'lockOnMinimize') {
            window.dispatchEvent(new Event('settings-changed'));
        }
    };

    const handleBrowse = async () => {
        if (isElectron && window.electron) {
            try {
                const path = await window.electron.selectFolder();
                if (path) {
                    handleSave('backupPath', path);
                }
            } catch (error) {
                console.error('Failed to select folder:', error);
                showToast('Failed to open folder selector', 'error');
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center animate-in fade-in duration-200">
            <div className="bg-bg-card w-full max-w-lg rounded-xl shadow-2xl border border-border-primary overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary bg-bg-sidebar">
                    <h2 className="text-lg font-bold text-text-primary">Settings</h2>
                    <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded-full text-text-secondary transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-8 flex-1">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Editor Preferences */}
                            <section>
                                <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">Editor Preferences</h3>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-text-primary">Default Font Size (px)</label>
                                    <div className="flex items-center bg-bg-app border border-border-secondary rounded-lg px-3 py-2">
                                        <input
                                            type="number"
                                            min="8"
                                            max="72"
                                            className="bg-transparent w-full text-sm text-text-primary focus:outline-none"
                                            value={settings.defaultFontSize}
                                            onChange={(e) => {
                                                let val = parseInt(e.target.value) || 14;
                                                if (val > 72) val = 72;
                                                if (val < 8) val = 8;
                                                handleSave('defaultFontSize', val);
                                            }}
                                        />
                                        <span className="text-xs text-text-muted ml-2">px</span>
                                    </div>
                                </div>

                                <ToolbarCustomizeSection />
                            </section>

                            <div className="h-px bg-border-primary" />

                            {/* Appearance Section — grouped right after editor prefs so all
                                theme controls (mode, palette, colors) live together. */}
                            <ThemeSettings settings={settings} onSave={handleSave} />

                            <div className="h-px bg-border-primary" />

                            {/* Menus Section — show/hide menu items (J8 customizable menus). */}
                            <MenuCustomizeSection />

                            <div className="h-px bg-border-primary" />

                            {/* Backup Section */}
                            <section>
                                <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">Backup Preferences</h3>
                                {/* ... rest of backup section ... */}
                                <div className="space-y-5">
                                    {/* Desktop Only Auto Backup Settings */}
                                    {isElectron ? (
                                        <>
                                            {/* Backup Path */}
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-text-primary">Backup Location</label>
                                                <div className="flex items-center space-x-2">
                                                    <div className="flex-1 bg-bg-app border border-border-secondary rounded-lg px-3 py-2 text-sm text-text-secondary truncate font-mono">
                                                        {settings.backupPath || <span className="italic opacity-50">No path selected</span>}
                                                    </div>
                                                    <button
                                                        onClick={handleBrowse}
                                                        className="px-3 py-2 bg-bg-hover hover:bg-bg-active border border-border-secondary rounded-lg text-text-primary transition-colors flex items-center"
                                                    >
                                                        <Folder size={16} className="mr-2" />
                                                        Browse
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Auto Backup Toggle */}
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <label className="text-sm font-medium text-text-primary block">Auto-backup on Exit</label>
                                                    <p className="text-xs text-text-muted mt-0.5">Automatically backup database when closing app</p>
                                                </div>
                                                <button
                                                    onClick={() => handleSave('autoBackupOnClose', !settings.autoBackupOnClose)}
                                                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-primary ${settings.autoBackupOnClose ? 'bg-accent-primary' : 'bg-gray-200 dark:bg-gray-700'}`}
                                                >
                                                    <span className={`absolute top-1 left-1 bg-white border border-gray-100 dark:border-0 w-4 h-4 rounded-full shadow transform transition-transform duration-200 ${settings.autoBackupOnClose ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <label className="text-sm font-medium text-text-primary">Backup Frequency</label>
                                                    <div className="flex items-center bg-bg-app border border-border-secondary rounded-lg px-3 py-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            className="bg-transparent w-full text-sm text-text-primary focus:outline-none"
                                                            value={settings.backupFrequency}
                                                            onChange={(e) => handleSave('backupFrequency', parseInt(e.target.value) || 1)}
                                                        />
                                                        <span className="text-xs text-text-muted ml-2">Days</span>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-sm font-medium text-text-primary">Retention Policy</label>
                                                    <div className="flex items-center bg-bg-app border border-border-secondary rounded-lg px-3 py-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            className="bg-transparent w-full text-sm text-text-primary focus:outline-none"
                                                            value={settings.retentionCount}
                                                            onChange={(e) => handleSave('retentionCount', parseInt(e.target.value) || 1)}
                                                        />
                                                        <span className="text-xs text-text-muted ml-2">Backups</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="p-4 bg-accent-primary/10 border border-accent-primary/20 rounded-lg">
                                            <p className="text-sm text-accent-primary">
                                                <strong>Web Mode:</strong> Database auto-backup and folder selection are only available in the Desktop version. You can manually export and import your database below.
                                            </p>
                                        </div>
                                    )}

                                    {/* Manual Actions */}
                                    <div className="flex gap-4 pt-2">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    if (isElectron && window.electron) {
                                                        const success = await window.electron.exportDatabase();
                                                        if (success) {
                                                            showToast('Database exported successfully', 'success');
                                                        } else {
                                                            showToast('Export failed or was cancelled', 'error');
                                                        }
                                                    } else {
                                                        // Robust Browser Download via Fetch (handles auth better)
                                                        const res = await fetch('/api/backup/export');
                                                        if (!res.ok) throw new Error('Export API returned error');
                                                        
                                                        const blob = await res.blob();
                                                        const url = window.URL.createObjectURL(blob);
                                                        const link = document.createElement('a');
                                                        link.href = url;
                                                        link.download = `journal-export-${new Date().toISOString().split('T')[0]}.tjdb`;
                                                        document.body.appendChild(link);
                                                        link.click();
                                                        document.body.removeChild(link);
                                                        // Important: Defer URL revocation so the browser has time to start the download
                                                        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
                                                        showToast('Database download started', 'success');
                                                    }
                                                } catch (err) {
                                                    console.error('Export failed:', err);
                                                    showToast('Database export failed', 'error');
                                                }
                                            }}
                                            className="flex-1 py-2 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/30 rounded-lg text-sm font-medium transition-colors"
                                        >
                                            Export Database Now
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (isElectron && window.electron) {
                                                    const filePath = await window.electron.importDatabase();
                                                    if (filePath && confirm("This will overwrite your current journal database. Continue?")) {
                                                        try {
                                                            // Electron: send the OS path as JSON — server reads file directly
                                                            const importRes = await fetch('/api/backup/import', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ filePath }),
                                                            });
                                                            if (importRes.ok) window.location.reload();
                                                            else {
                                                                const err = await importRes.json().catch(() => ({}));
                                                                showToast(`Import Failed: ${err.details || err.error}`, 'error');
                                                            }
                                                        } catch (err) {
                                                            console.error('Import error:', err);
                                                            showToast('Import failed', 'error');
                                                        }
                                                    }
                                                } else {
                                                    const input = document.createElement('input');
                                                    input.type = 'file';
                                                    input.accept = '.tjdb,.db,.sqlite';
                                                    input.onchange = async (e) => {
                                                        const file = (e.target as HTMLInputElement).files?.[0];
                                                        if (file && confirm("This will overwrite your current journal database. Continue?")) {
                                                            const formData = new FormData();
                                                            formData.append('file', file);
                                                            const res = await fetch('/api/backup/import', { method: 'POST', body: formData });
                                                            if (res.ok) window.location.reload();
                                                            else showToast("Import Failed", "error");
                                                        }
                                                    };
                                                    input.click();
                                                }
                                            }}
                                            className="flex-1 py-2 bg-text-secondary/5 hover:bg-text-secondary/10 text-text-primary border border-border-primary rounded-lg text-sm font-medium transition-colors"
                                        >
                                            Import Data...
                                        </button>
                                    </div>
                                </div>
                            </section>

                            <div className="h-px bg-border-primary" />

                            {/* Security Section */}
                            <section>
                                <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">Security</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="text-sm font-medium text-text-primary">Auto-lock when idle</label>
                                            <p className="text-xs text-text-muted">Return to login screen after N minutes of inactivity. 0 disables.</p>
                                        </div>
                                        <input
                                            type="number"
                                            min={0}
                                            max={240}
                                            value={settings.idleLockMinutes ?? 0}
                                            onChange={(e) => handleSave('idleLockMinutes', Math.max(0, Math.min(240, parseInt(e.target.value) || 0)))}
                                            className="w-20 p-2 text-sm rounded-lg bg-bg-active border border-border-primary text-text-primary text-center"
                                        />
                                    </div>
                                    {isElectron && (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <label className="text-sm font-medium text-text-primary">Lock when window is minimized</label>
                                                <p className="text-xs text-text-muted">Hides the journal as soon as the window is minimized.</p>
                                            </div>
                                            <button
                                                onClick={() => handleSave('lockOnMinimize', !settings.lockOnMinimize)}
                                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-primary ${settings.lockOnMinimize ? 'bg-accent-primary' : 'bg-gray-200 dark:bg-gray-700'}`}
                                            >
                                                <span className={`absolute top-1 left-1 bg-white border border-gray-100 dark:border-0 w-4 h-4 rounded-full shadow transform transition-transform duration-200 ${settings.lockOnMinimize ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                    )}
                                    {isElectron && (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <label className="text-sm font-medium text-text-primary">Minimize to system tray</label>
                                                <p className="text-xs text-text-muted">Closing the window keeps the app running in the tray instead of quitting.</p>
                                            </div>
                                            <button
                                                onClick={() => handleSave('minimizeToTray', !settings.minimizeToTray)}
                                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-primary ${settings.minimizeToTray ? 'bg-accent-primary' : 'bg-gray-200 dark:bg-gray-700'}`}
                                            >
                                                <span className={`absolute top-1 left-1 bg-white border border-gray-100 dark:border-0 w-4 h-4 rounded-full shadow transform transition-transform duration-200 ${settings.minimizeToTray ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                    )}
                                    <p className="text-xs text-text-muted">
                                        Press <kbd className="px-1.5 py-0.5 rounded bg-bg-active border border-border-primary text-[10px]">Ctrl</kbd>
                                        +<kbd className="px-1.5 py-0.5 rounded bg-bg-active border border-border-primary text-[10px]">Shift</kbd>
                                        +<kbd className="px-1.5 py-0.5 rounded bg-bg-active border border-border-primary text-[10px]">L</kbd> at any time to lock immediately.
                                    </p>
                                </div>
                            </section>

                            <div className="h-px bg-border-primary" />

                            {/* Keyboard Shortcuts Section */}
                            <KeybindingsSection />

                            <div className="h-px bg-border-primary" />

                            {/* Plugins Section — same in Electron and web. */}
                            <PluginsSection />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-bg-sidebar border-t border-border-primary flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-accent-primary text-white text-sm font-medium rounded-lg hover:bg-opacity-90 transition-opacity shadow-lg shadow-accent-primary/20"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

// Customize which editor toolbar groups are shown (J8 "Customize Toolbar").
// Persists to localStorage via toolbarConfig + notifies open toolbars to re-read.
function ToolbarCustomizeSection() {
    const [hidden, setHidden] = useState(() => loadToolbarConfig());
    const onToggle = (id: string) => {
        const next = toggleGroup(hidden, id);
        setHidden(next);
        saveToolbarConfig(next);
    };
    return (
        <div className="space-y-2 mt-5">
            <label className="text-sm font-medium text-text-primary">Editor Toolbar Buttons</label>
            <p className="text-xs text-text-muted">Hide toolbar groups you don&apos;t use. Affects the rich-text editor toolbar.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                {TOOLBAR_GROUPS.map(g => {
                    const visible = isGroupVisible(hidden, g.id);
                    return (
                        <label key={g.id} className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={visible}
                                onChange={() => onToggle(g.id)}
                                className="accent-[color:var(--color-accent-primary)]"
                            />
                            {g.label}
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

// Customize which menu items appear (J8 customizable menus). Persists the
// hidden-id set via menuCustomConfig (localStorage + Electron settings.json),
// applied to both the web MenuBar and the native menu.
function MenuCustomizeSection() {
    const [hidden, setHidden] = useState(() => loadMenuHidden());
    const [expanded, setExpanded] = useState(false);
    const rows = listMenuItems(J8_MENUS);
    const onToggle = (id: string) => {
        const next = new Set(hidden);
        if (next.has(id)) next.delete(id); else next.add(id);
        setHidden(next);
        saveMenuHidden(next);
    };
    return (
        <section>
            <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-2">Menus</h3>
            <p className="text-xs text-text-muted mb-2">
                Hide menu items you don&apos;t use. Hidden items still work via their keyboard shortcut.
                {hidden.size > 0 ? ` (${hidden.size} hidden)` : ''}
            </p>
            <button
                onClick={() => setExpanded(v => !v)}
                className="text-xs px-2 py-1 rounded bg-bg-active border border-border-primary text-text-primary hover:bg-bg-hover mb-2"
            >
                {expanded ? 'Hide menu list' : 'Customize menu items…'}
            </button>
            {expanded && (
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border-primary p-2 space-y-0.5">
                    {rows.map(r => (
                        <label
                            key={r.id}
                            className={`flex items-center gap-2 text-sm cursor-pointer select-none ${r.depth === 0 ? 'font-semibold text-text-primary mt-1.5' : 'text-text-secondary'}`}
                            style={{ paddingLeft: r.depth * 14 }}
                        >
                            <input
                                type="checkbox"
                                checked={!hidden.has(r.id)}
                                onChange={() => onToggle(r.id)}
                                className="accent-[color:var(--color-accent-primary)]"
                            />
                            {r.label}
                        </label>
                    ))}
                </div>
            )}
        </section>
    );
}

// Theme Settings Sub-component
function ThemeSettings({ settings, onSave }: { settings: Settings, onSave: (key: keyof Settings, val: Settings[keyof Settings]) => void }) {
    const { theme, setTheme, systemTheme } = useTheme();
    // Initialize mode to current resolved theme
    const resolvedTheme = theme === 'system' ? systemTheme : theme;
    const [mode, setMode] = useState<'light' | 'dark'>((resolvedTheme as 'light' | 'dark') || 'dark');

    // Sync mode whenever app theme changes while modal is open
    useEffect(() => {
        if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
            setMode(resolvedTheme);
        }
    }, [resolvedTheme]);

    const handleThemeSwitch = (newMode: 'light' | 'dark') => {
        setMode(newMode);
        setTheme(newMode);
        // Persist theme choice globally if in Electron
        if (window.electron) {
            window.electron.saveSetting('theme', newMode);
        }
    };

    const handleColorChange = (key: string, value: string) => {
        const currentPrefs = settings.themePreferences || {};
        const modePrefs = currentPrefs[mode] || {};

        onSave('themePreferences', {
            ...currentPrefs,
            [mode]: {
                ...modePrefs,
                [key]: value
            }
        });

        // Trigger live update event
        window.dispatchEvent(new Event('theme-settings-changed'));
    };

    const prefs = settings.themePreferences?.[mode] || {};

    return (
        <section>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider">Appearance</h3>
                <div className="flex bg-bg-app rounded-lg p-1 border border-border-secondary">
                    <button
                        onClick={() => handleThemeSwitch('light')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'light' ? 'bg-bg-card shadow text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                        Light
                    </button>
                    <button
                        onClick={() => handleThemeSwitch('dark')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'dark' ? 'bg-bg-card shadow text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                        Dark
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-text-primary">Theme Palette</label>
                    <select
                        className="w-full bg-bg-app border border-border-secondary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none"
                        value={settings.themePalette || 'default'}
                        onChange={(e) => onSave('themePalette', e.target.value)}
                    >
                        {THEME_PALETTES.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                    <p className="text-xs text-text-muted">Layered over light/dark mode. Some palettes are tuned for a specific mode.</p>
                </div>
                <ColorPicker
                    label="Accent Color"
                    value={prefs.accentPrimary || (mode === 'dark' ? '#14b8a6' : '#9333ea')}
                    onChange={(v) => handleColorChange('accentPrimary', v)}
                />
                <ColorPicker
                    label="App Background"
                    value={prefs.bgApp || (mode === 'dark' ? '#000000' : '#f3f4f6')}
                    onChange={(v) => handleColorChange('bgApp', v)}
                />
                <ColorPicker
                    label="Sidebar Background"
                    value={prefs.bgSidebar || (mode === 'dark' ? '#0a0a0a' : '#ffffff')}
                    onChange={(v) => handleColorChange('bgSidebar', v)}
                />
            </div>
        </section>
    );
}

function ColorPicker({ label, value, onChange }: { label: string, value: string, onChange: (val: string) => void }) {
    return (
        <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-primary">{label}</label>
            <div className="flex items-center space-x-3">
                <span className="text-xs text-text-secondary font-mono uppercase">{value}</span>
                <div className="relative w-8 h-8 rounded-full overflow-hidden border border-border-secondary shadow-sm ring-2 ring-transparent hover:ring-accent-secondary transition-all">
                    <input
                        type="color"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="absolute inset-0 w-[150%] h-[150%] -top-1/4 -left-1/4 p-0 m-0 cursor-pointer opacity-0"
                    />
                    <div className="w-full h-full" style={{ backgroundColor: value }} />
                </div>
            </div>
        </div>
    );
}
