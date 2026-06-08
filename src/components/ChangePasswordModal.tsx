"use client";

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

/**
 * Change the current user's login password. Replaces the old three-window.prompt
 * flow, which was silently dead in the Electron renderer (window.prompt is a
 * no-op there). One styled dialog with current / new / confirm fields + inline
 * validation; persists via POST /api/user/password.
 */
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
    useEscapeToClose(onClose);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const firstRef = useRef<HTMLInputElement>(null);

    useEffect(() => { firstRef.current?.focus(); }, []);

    const submit = async () => {
        if (busy) return;
        if (!oldPassword || !newPassword) { setError('Please fill in every field.'); return; }
        if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
        if (newPassword !== confirmPassword) { setError('New passwords do not match.'); return; }
        setBusy(true);
        try {
            const res = await fetch('/api/user/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword }),
            });
            if (res.ok) { onClose(); window.alert('Password changed.'); return; }
            const d = await res.json().catch(() => ({}));
            setError(d.reason === 'wrong-password' ? 'Current password is incorrect.'
                : d.reason === 'weak' ? 'New password must be at least 8 characters.'
                : 'Could not change password.');
        } catch {
            setError('Could not change password. See console for details.');
        } finally {
            setBusy(false);
        }
    };

    const field = (label: string, value: string, set: (v: string) => void, ref?: React.RefObject<HTMLInputElement | null>) => (
        <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">{label}</label>
            <input
                ref={ref}
                type="password"
                value={value}
                onChange={e => { set(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                className="w-full rounded border border-border-primary bg-bg-app px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-primary"
            />
        </div>
    );

    return (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/40" onMouseDown={onClose}>
            <div className="w-[26rem] max-w-[90vw] rounded-lg border border-border-primary bg-bg-card p-4 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
                <div className="mb-3 flex items-start justify-between gap-4">
                    <h3 className="text-sm font-semibold text-text-primary">Change Password</h3>
                    <button onClick={onClose} className="p-0.5 rounded text-text-muted hover:text-text-primary" title="Close">
                        <X size={16} />
                    </button>
                </div>
                <div className="space-y-3">
                    {field('Current password', oldPassword, setOldPassword, firstRef)}
                    {field('New password (min 8 characters)', newPassword, setNewPassword)}
                    {field('Confirm new password', confirmPassword, setConfirmPassword)}
                </div>
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                    <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-app">Cancel</button>
                    <button onClick={() => void submit()} disabled={busy}
                        className="rounded bg-accent-primary px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50">
                        Change Password
                    </button>
                </div>
            </div>
        </div>
    );
}
