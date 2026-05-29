"use client";

import { useEffect, useState, useCallback } from 'react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

interface UserRow { UserID: number; Username: string; }

export default function ManageUsersModal({ onClose }: { onClose: () => void }) {
    useEscapeToClose(onClose);
    const [users, setUsers] = useState<UserRow[]>([]);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch('/api/users');
        if (res.ok) setUsers(await res.json());
    }, []);

    useEffect(() => { void load(); }, [load]);

    const add = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setError(data.error || `HTTP ${res.status}`); return; }
            setUsername(''); setPassword('');
            await load();
        } finally { setBusy(false); }
    };

    const remove = async (id: number, name: string) => {
        if (!confirm(`Delete user "${name}" and all of their journals? This cannot be undone.`)) return;
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || `HTTP ${res.status}`); return; }
        await load();
    };

    return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-5 w-[420px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-text-primary">Manage Users</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
                </div>

                <ul className="mb-4 max-h-48 overflow-y-auto divide-y divide-border-primary">
                    {users.map(u => (
                        <li key={u.UserID} className="flex items-center justify-between py-1.5 text-sm">
                            <span className="text-text-primary">{u.Username}</span>
                            <button onClick={() => remove(u.UserID, u.Username)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                        </li>
                    ))}
                    {users.length === 0 && <li className="py-2 text-xs text-text-muted">No users.</li>}
                </ul>

                <div className="border-t border-border-primary pt-3 space-y-2">
                    <div className="text-xs uppercase tracking-wider text-text-muted">Add user</div>
                    <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username"
                        className="w-full p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]" />
                    <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password (min 8 chars)"
                        className="w-full p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]" />
                    {error && <div className="text-xs text-red-400">{error}</div>}
                    <div className="flex justify-end">
                        <button onClick={add} disabled={busy} className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 disabled:opacity-50">Add user</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
