"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from 'next-themes';
import SettingsModal from './SettingsModal';
import { logout } from '@/app/actions';

export default function GlobalIPCManager() {
    const { setTheme } = useTheme();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const handleExportClick = useCallback(async () => {
        if (window.electron) {
            await window.electron.exportDatabase();
        } else {
            window.open('/api/backup/export', '_blank');
        }
    }, []);

    const handleFileImport = useCallback(async (filePath: string) => {
        if (!confirm("Overwrite your current data with the imported database?")) return;

        try {
            let res: Response;

            if (window.electron) {
                res = await fetch('/api/backup/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath }),
                });
            } else {
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

    // Stash the latest callbacks in refs so the IPC effect can subscribe exactly
    // once on mount. Without this, an identity change in any callback or in
    // setTheme would tear down + re-register every Electron IPC listener.
    const callbacksRef = useRef({
        setTheme,
        handleExportClick,
        handleFileImport,
        handleLogout,
        dispatchViewAction,
    });
    callbacksRef.current = {
        setTheme,
        handleExportClick,
        handleFileImport,
        handleLogout,
        dispatchViewAction,
    };

    useEffect(() => {
        if (window.electron) {
            window.electron.getSettings().then((settings) => {
                if (settings && settings.theme) {
                    callbacksRef.current.setTheme(settings.theme);
                }
            });
        }

        const handleOpenSettings = () => setIsSettingsOpen(true);
        window.addEventListener('trigger-settings', handleOpenSettings);

        if (!window.electron) return () => {
            window.removeEventListener('trigger-settings', handleOpenSettings);
        };

        const unsubscribeOpenSettings = window.electron.onOpenSettings?.(() => {
            setIsSettingsOpen(true);
        });

        const unsubscribeToggleTheme = window.electron.onToggleTheme?.(() => {
            callbacksRef.current.setTheme(currentTheme => {
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                if (window.electron) {
                    window.electron.saveSetting('theme', newTheme);
                }
                return newTheme;
            });
        });

        const unsubscribeImport = window.electron.onImportDB?.((filePath: string) => {
            callbacksRef.current.handleFileImport(filePath);
        });

        const unsubscribeExport = window.electron.onExportDB?.(() => {
            callbacksRef.current.handleExportClick();
        });

        const unsubscribeLogout = window.electron.onLogoutRequest?.(() => {
            callbacksRef.current.handleLogout();
        });

        const unsubscribeViewAction = window.electron.onViewAction?.((action: string) => {
            callbacksRef.current.dispatchViewAction(action);
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
    }, []);

    return (
        <>
            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </>
    );
}
