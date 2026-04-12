"use client";

import { useEffect, useState } from 'react';
import { X, Folder } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useToast } from './Toast';

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
    defaultFontSize: number;
}

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
        themePreferences: {},
    });
    const [loading, setLoading] = useState(true);
    const [isElectron, setIsElectron] = useState(false);

    useEffect(() => {
        // Detect Electron environment safely on mount
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
        const isEl = userAgent.includes(' electron/') || !!(window as any).electron;
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
                        defaultFontSize: saved.defaultFontSize || 14,
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
                                                handleSave('defaultFontSize', val);
                                            }}
                                        />
                                        <span className="text-xs text-text-muted ml-2">px</span>
                                    </div>
                                </div>
                            </section>

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
                                                    if (filePath && confirm("This will overwrite your current journal database with the selected file. Continue?")) {
                                                        const res = await fetch(filePath);
                                                        const blob = await res.blob();
                                                        const formData = new FormData();
                                                        formData.append('file', blob);
                                                        const importRes = await fetch('/api/backup/import', { method: 'POST', body: formData });
                                                        if (importRes.ok) window.location.reload();
                                                        else showToast("Import Failed", 'error');
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

                            {/* Appearance Section */}
                            <ThemeSettings settings={settings} onSave={handleSave} />
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
