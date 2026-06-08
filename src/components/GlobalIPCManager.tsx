"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useTheme } from 'next-themes';
import SettingsModal from './SettingsModal';
import ManageUsersModal from './ManageUsersModal';
import ManageTopicsModal from './ManageTopicsModal';
import JournalVolumesModal from './JournalVolumesModal';
import ChangePasswordModal from './ChangePasswordModal';
import { logout } from '@/app/actions';
import { logAction } from '@/lib/actionLog';
import { SETTINGS_SECTION_FOR_ACTION } from '@/lib/menuActions';

export default function GlobalIPCManager() {
    const { setTheme } = useTheme();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settingsSection, setSettingsSection] = useState<string | null>(null);
    const [showManageUsers, setShowManageUsers] = useState(false);
    const [showManageTopics, setShowManageTopics] = useState(false);
    const [showVolumes, setShowVolumes] = useState(false);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const restoreInputRef = useRef<HTMLInputElement>(null);

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

    // David RM database/admin actions. Triggered by the Electron File menu
    // (view-action → trigger-*) or by web menu buttons; both dispatch the same
    // window events so the logic lives in one place and works on both targets.
    useEffect(() => {
        const onCheckIntegrity = async () => {
            try {
                const data = await (await fetch('/api/db/integrity')).json();
                if (data.ok) alert('Integrity check passed — no problems found.');
                else alert('Integrity issues found:\n' + (data.messages || []).join('\n'));
            } catch { alert('Integrity check failed. See console for details.'); }
        };
        const onOptimize = async () => {
            if (!confirm('Optimize and defragment the database now? This may take a moment.')) return;
            try {
                const data = await (await fetch('/api/db/optimize', { method: 'POST' })).json();
                if (data.ok) {
                    const mb = typeof data.bytesReclaimed === 'number'
                        ? ` Reclaimed ${(data.bytesReclaimed / 1024 / 1024).toFixed(2)} MB.` : '';
                    alert('Database optimized.' + mb);
                } else alert('Optimize failed.');
            } catch { alert('Optimize failed. See console for details.'); }
        };
        const onChangePassword = () => setShowChangePassword(true);
        const onSwitchUser = async () => {
            if (!confirm('Log out and switch to a different user?')) return;
            await handleLogout();
        };
        const onManageUsers = () => setShowManageUsers(true);
        const onManageTopics = () => setShowManageTopics(true);
        const onToggleTheme = () => setTheme((cur) => (cur === 'dark' ? 'light' : 'dark'));
        // "Set up Automatic Login…" — auto-login is the Remember-Me credential
        // saved at login; its on/off control lives in Settings ▸ Security.
        const onAutoLogin = () => { setSettingsSection('security'); setIsSettingsOpen(true); };
        const onRestoreDb = () => restoreInputRef.current?.click();
        const onVolumes = () => setShowVolumes(true);
        const onLogout = () => { void handleLogout(); };
        const onCheckUpdates = async () => {
            try {
                const health = await (await fetch('/api/health')).json().catch(() => ({}));
                const current = health.version ?? 'unknown';
                let latest = '';
                try {
                    const rel = await (await fetch('https://api.github.com/repos/danielttran/TheJournal/releases/latest')).json();
                    latest = rel?.tag_name ?? '';
                } catch { /* offline / rate-limited */ }
                alert(latest
                    ? `Installed version: ${current}\nLatest release: ${latest}\n\n${latest.replace(/^v/, '') === String(current).replace(/^v/, '') ? "You're up to date." : 'A newer version is available; redeploy to update.'}`
                    : `Installed version: ${current}\n\nThe web app updates when the server is redeployed.`);
            } catch { alert('Could not check for updates.'); }
        };
        window.addEventListener('trigger-manage-topics', onManageTopics);
        window.addEventListener('trigger-toggle-theme', onToggleTheme);
        window.addEventListener('trigger-journal-volumes', onVolumes);
        window.addEventListener('trigger-logout', onLogout);
        window.addEventListener('trigger-check-updates', onCheckUpdates);
        window.addEventListener('trigger-check-integrity', onCheckIntegrity);
        window.addEventListener('trigger-optimize-db', onOptimize);
        window.addEventListener('trigger-change-password', onChangePassword);
        window.addEventListener('trigger-switch-user', onSwitchUser);
        window.addEventListener('trigger-manage-users', onManageUsers);
        window.addEventListener('trigger-auto-login', onAutoLogin);
        window.addEventListener('trigger-restore-db', onRestoreDb);
        return () => {
            window.removeEventListener('trigger-check-integrity', onCheckIntegrity);
            window.removeEventListener('trigger-optimize-db', onOptimize);
            window.removeEventListener('trigger-change-password', onChangePassword);
            window.removeEventListener('trigger-switch-user', onSwitchUser);
            window.removeEventListener('trigger-manage-users', onManageUsers);
            window.removeEventListener('trigger-manage-topics', onManageTopics);
            window.removeEventListener('trigger-toggle-theme', onToggleTheme);
            window.removeEventListener('trigger-journal-volumes', onVolumes);
            window.removeEventListener('trigger-logout', onLogout);
            window.removeEventListener('trigger-check-updates', onCheckUpdates);
            window.removeEventListener('trigger-auto-login', onAutoLogin);
            window.removeEventListener('trigger-restore-db', onRestoreDb);
        };
    }, [handleLogout, setTheme]);

    const dispatchViewAction = useCallback((action: string) => {
        logAction('electron menu', action);
        // run-plugin-<id> carries the plugin id in a CustomEvent detail so the
        // editor can invoke that plugin's registered action (Electron path).
        if (action.startsWith('run-plugin-')) {
            window.dispatchEvent(new CustomEvent('trigger-run-plugin', { detail: { id: action.slice('run-plugin-'.length) } }));
            return;
        }
        // Menu items that open Settings at a specific section (Manage Plugins,
        // Keyboard Shortcuts) carry the target section so the modal scrolls there.
        const section = SETTINGS_SECTION_FOR_ACTION[action];
        if (section) {
            window.dispatchEvent(new CustomEvent('trigger-settings', { detail: { section } }));
            return;
        }
        window.dispatchEvent(new CustomEvent(`trigger-${action}`));
    }, []);

    // Stash the latest callbacks in refs so the IPC effect can subscribe exactly
    // once on mount. Without this, an identity change in any callback or in
    // setTheme would tear down + re-register every Electron IPC listener.
    // The sync runs in a layout effect (not during render) per React 19 rules —
    // mutating a ref during render is now a violation.
    const callbacksRef = useRef({
        setTheme,
        handleExportClick,
        handleFileImport,
        handleLogout,
        dispatchViewAction,
    });
    useLayoutEffect(() => {
        callbacksRef.current = {
            setTheme,
            handleExportClick,
            handleFileImport,
            handleLogout,
            dispatchViewAction,
        };
    });

    useEffect(() => {
        if (window.electron) {
            window.electron.getSettings().then((settings) => {
                const theme = settings?.theme;
                if (typeof theme === 'string') {
                    callbacksRef.current.setTheme(theme);
                }
            });
        }

        const handleOpenSettings = (e: Event) => {
            const section = (e as CustomEvent<{ section?: string }>).detail?.section;
            setSettingsSection(typeof section === 'string' ? section : null);
            setIsSettingsOpen(true);
        };
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
            <SettingsModal
                isOpen={isSettingsOpen}
                initialSection={settingsSection}
                onClose={() => { setIsSettingsOpen(false); setSettingsSection(null); }}
            />
            {showManageUsers && <ManageUsersModal onClose={() => setShowManageUsers(false)} />}
            {showManageTopics && <ManageTopicsModal onClose={() => setShowManageTopics(false)} />}
            {showVolumes && <JournalVolumesModal onClose={() => setShowVolumes(false)} />}
            {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
            <input
                ref={restoreInputRef}
                type="file"
                accept=".db,.sqlite,.tjdb"
                className="hidden"
                onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (!confirm('Restore this backup? It overwrites your current journal volume.')) return;
                    const fd = new FormData();
                    fd.append('file', f);
                    const res = await fetch('/api/backup/import', { method: 'POST', body: fd });
                    if (res.ok) window.location.reload();
                    else { const d = await res.json().catch(() => ({})); alert(`Restore failed: ${d.error || res.statusText}`); }
                }}
            />
        </>
    );
}
