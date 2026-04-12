"use client";

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import SettingsModal from './SettingsModal';
import { logout } from '@/app/actions';

export default function GlobalIPCManager() {
    const { theme, setTheme } = useTheme();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const handleExportClick = useCallback(async () => {
        if (window.electron) {
            // In Electron, use the native Save dialog via IPC (already wired in main.js)
            await window.electron.exportDatabase();
        } else {
            // Web: trigger the streaming download endpoint
            window.open('/api/backup/export', '_blank');
        }
    }, []);

    const handleFileImport = useCallback(async (filePath: string) => {
        if (!confirm("Overwrite your current data with the imported database?")) return;

        try {
            let res: Response;

            if (window.electron) {
                // Electron: send the local file path as JSON.
                // The server reads the file directly from disk — no base64 encoding needed.
                res = await fetch('/api/backup/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath }),
                });
            } else {
                // Web: filePath is an http(s) URL from a <input type="file"> object URL
                const response = await fetch(filePath);
                const blob = await response.blob();
                const formData = new FormData();
                formData.append('file', blob, filePath.split(/[/\\]/).pop() || 'import.db');
                res = await fetch('/api/backup/import', { method: 'POST', body: formData });
            }

            if (res.ok) window.location.reload();
            else {
                const err = await res.json().catch(() => ({}));
                alert(`Import Failed: ${err.details || err.error || res.statusText}`);
            }
        } catch (err) {
            console.error('Import error:', err);
            alert('Import failed. See console for details.');
        }
    }, []);


    const handleLogout = useCallback(async () => {
        if (window.electron) {
            await window.electron.logout();
        }
        await logout();
    }, []);

    const dispatchViewAction = useCallback((action: string) => {
        window.dispatchEvent(new CustomEvent(`trigger-${action}`));
    }, []);

    useEffect(() => {
        // Initial load for Electron
        if (window.electron) {
            window.electron.getSettings().then((settings) => {
                if (settings && settings.theme) {
                    setTheme(settings.theme);
                }
            });
        }

        // Listen for global settings trigger (works for both Electron and Web custom events)
        const handleOpenSettings = () => setIsSettingsOpen(true);
        window.addEventListener('trigger-settings', handleOpenSettings);
        
        if (!window.electron) return () => {
            window.removeEventListener('trigger-settings', handleOpenSettings);
        };

        const unsubscribeOpenSettings = window.electron.onOpenSettings?.(() => {
            setIsSettingsOpen(true);
        });

        const unsubscribeToggleTheme = window.electron.onToggleTheme?.(() => {
            setTheme(currentTheme => {
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                if (window.electron) {
                    window.electron.saveSetting('theme', newTheme);
                }
                return newTheme;
            });
        });

        const unsubscribeImport = window.electron.onImportDB?.((filePath: string) => {
            handleFileImport(filePath);
        });

        const unsubscribeExport = window.electron.onExportDB?.(() => {
            handleExportClick();
        });

        const unsubscribeLogout = window.electron.onLogoutRequest?.(() => {
            handleLogout();
        });

        const unsubscribeViewAction = window.electron.onViewAction?.((action: string) => {
            dispatchViewAction(action);
        });

        return () => {
            window.removeEventListener('trigger-settings', handleOpenSettings);
            unsubscribeOpenSettings?.();
            unsubscribeToggleTheme?.();
            unsubscribeImport?.();
            unsubscribeExport?.();
            unsubscribeLogout?.();
            unsubscribeViewAction?.();
        };
    }, [setTheme, handleExportClick, handleFileImport, handleLogout, dispatchViewAction]);

    return (
        <>
            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </>
    );
}
