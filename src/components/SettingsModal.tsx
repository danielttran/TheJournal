"use client";

import { useEffect, useState } from 'react';
import { X, Folder } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Settings {
    backupPath: string;
    autoBackupOnClose: boolean;
    backupFrequency: number;
    retentionCount: number;
    themePreferences?: any;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [settings, setSettings] = useState<Settings>({
        backupPath: '',
        autoBackupOnClose: false,
        backupFrequency: 3,
        retentionCount: 3,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            if (window.electron) {
                window.electron.getSettings().then((saved: any) => {
                    setSettings({
                        backupPath: saved.backupPath || '',
                        autoBackupOnClose: saved.autoBackupOnClose || false,
                        backupFrequency: saved.backupFrequency || 3,
                        retentionCount: saved.retentionCount || 3,
                        themePreferences: saved.themePreferences || {}
                    });
                    setLoading(false);
                });
            } else {
                // Web Fallback: LocalStorage
                try {
                    const savedStr = localStorage.getItem('app-settings');
                    const saved = savedStr ? JSON.parse(savedStr) : {};
                    setSettings({
                        backupPath: saved.backupPath || '', // Not really used on web
                        autoBackupOnClose: saved.autoBackupOnClose || false,
                        backupFrequency: saved.backupFrequency || 3,
                        retentionCount: saved.retentionCount || 3,
                        themePreferences: saved.themePreferences || {}
                    });
                } catch (e) { console.error("Failed to load settings", e); }
                setLoading(false);
            }
        }
    }, [isOpen]);

    const handleSave = async (key: keyof Settings | 'themePreferences', value: any) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);

        if (window.electron) {
            await window.electron.saveSetting(key as string, value);
        } else {
            // Web Fallback
            localStorage.setItem('app-settings', JSON.stringify(newSettings));
        }
    };

    const handleBrowse = async () => {
        if (window.electron) {
            const path = await window.electron.selectFolder();
            if (path) {
                handleSave('backupPath', path);
            }
        } else {
            alert("Backup path selection is only available in the desktop app.");
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
                            {/* Backup Section */}
                            <section>
                                <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">Backup Preferences</h3>

                                <div className="space-y-5">
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

                                    {/* Frequency & Retention */}
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
function ThemeSettings({ settings, onSave }: { settings: any, onSave: (key: any, val: any) => void }) {
    const [mode, setMode] = useState<'light' | 'dark'>('dark');

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
                        onClick={() => setMode('light')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'light' ? 'bg-bg-card shadow text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                        Light
                    </button>
                    <button
                        onClick={() => setMode('dark')}
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
