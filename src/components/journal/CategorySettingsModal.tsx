"use client";

import { useEffect, useState } from 'react';
import { X, Lock } from 'lucide-react';
import type { Template } from './TemplatePicker';
import type { Category } from '@/lib/types';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { eligibleParentIds } from '@/lib/categoryTree';

type SortMode =
    | 'manual'
    | 'title-asc' | 'title-desc'
    | 'created-newest' | 'created-oldest'
    | 'modified-newest' | 'modified-oldest';

interface SmartbookQueryShape {
    q?: string;
    tags?: string[];
    categoryIds?: number[];
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
}

interface Props {
    categoryId: number;
    onClose: () => void;
    onSaved?: (updated: Partial<Category>) => void;
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: 'manual', label: 'Manual order (drag to arrange)' },
    { value: 'title-asc', label: 'Title (A→Z)' },
    { value: 'title-desc', label: 'Title (Z→A)' },
    { value: 'created-newest', label: 'Created (newest first)' },
    { value: 'created-oldest', label: 'Created (oldest first)' },
    { value: 'modified-newest', label: 'Modified (newest first)' },
    { value: 'modified-oldest', label: 'Modified (oldest first)' },
];

export default function CategorySettingsModal({ categoryId, onClose, onSaved }: Props) {
    useEscapeToClose(onClose);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [category, setCategory] = useState<Category | null>(null);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [allCategories, setAllCategories] = useState<Category[]>([]);

    // Edited values
    const [viewType, setViewType] = useState<'Journal' | 'Notebook'>('Notebook');
    const [autoTemplateId, setAutoTemplateId] = useState<number>(0);
    const [entryFrequency, setEntryFrequency] = useState<'daily' | 'weekly' | 'hourly'>('daily');
    const [sortMode, setSortMode] = useState<SortMode>('manual');
    const [parentId, setParentId] = useState<number | null>(null);
    const [isSmartbook, setIsSmartbook] = useState(false);
    const [smartbookQuery, setSmartbookQuery] = useState<SmartbookQueryShape>({});

    // Per-category password state (independent of main Save flow)
    const [passwordLocked, setPasswordLocked] = useState(false);
    const [showPwSet, setShowPwSet] = useState(false);
    const [showPwClear, setShowPwClear] = useState(false);
    const [pwInput1, setPwInput1] = useState('');
    const [pwInput2, setPwInput2] = useState('');
    const [pwBusy, setPwBusy] = useState(false);
    const [pwError, setPwError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [catRes, tmplRes, allCatRes, lockRes] = await Promise.all([
                    fetch(`/api/category/${categoryId}`),
                    fetch('/api/template'),
                    fetch('/api/category'),
                    fetch(`/api/category/${categoryId}/lock`),
                ]);
                if (cancelled) return;
                if (!catRes.ok) throw new Error('Could not load category');
                const cat = await catRes.json() as Category;
                const tmpls = tmplRes.ok ? await tmplRes.json() as Template[] : [];
                const cats = allCatRes.ok ? await allCatRes.json() as Category[] : [];

                setCategory(cat);
                setTemplates(tmpls);
                setAllCategories(cats);

                setViewType((cat.Type ?? 'Notebook') as 'Journal' | 'Notebook');
                setAutoTemplateId(Number(cat.AutoTemplateID ?? 0));
                setEntryFrequency((cat.EntryFrequency ?? 'daily') as 'daily' | 'weekly' | 'hourly');
                setSortMode((cat.SortMode ?? 'manual') as SortMode);
                setParentId(cat.ParentCategoryID ?? null);
                setIsSmartbook(!!cat.IsSmartbook);
                if (cat.SmartbookQuery) {
                    try { setSmartbookQuery(JSON.parse(cat.SmartbookQuery) as SmartbookQueryShape); }
                    catch { setSmartbookQuery({}); }
                }

                if (lockRes.ok) {
                    const lockJson = await lockRes.json() as { locked: boolean };
                    setPasswordLocked(!!lockJson.locked);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [categoryId]);

    const handleSave = async () => {
        if (!category) return;
        setSaving(true);
        setError(null);
        const body: Record<string, unknown> = {
            type: viewType,
            sortMode,
            autoTemplateId: autoTemplateId || 0,
            entryFrequency,
            isSmartbook,
            parentCategoryId: parentId,
        };
        if (isSmartbook) {
            body.smartbookQuery = JSON.stringify(smartbookQuery);
        } else if (category.SmartbookQuery) {
            body.smartbookQuery = null;
        }
        try {
            const res = await fetch(`/api/category/${categoryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const next: Partial<Category> = {
                Type: viewType,
                SortMode: sortMode,
                ParentCategoryID: parentId,
                AutoTemplateID: autoTemplateId || null,
                EntryFrequency: entryFrequency,
                IsSmartbook: isSmartbook,
                SmartbookQuery: isSmartbook ? JSON.stringify(smartbookQuery) : null,
            };
            onSaved?.(next);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const updateQuery = (patch: Partial<SmartbookQueryShape>) =>
        setSmartbookQuery(q => ({ ...q, ...patch }));

    const handleSetPassword = async () => {
        if (pwInput1.length < 1) { setPwError('Password is required'); return; }
        if (pwInput1 !== pwInput2) { setPwError('Passwords do not match'); return; }
        setPwBusy(true);
        setPwError(null);
        try {
            const res = await fetch(`/api/category/${categoryId}/lock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwInput1 }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error?.toString?.() || `HTTP ${res.status}`);
            }
            setPasswordLocked(true);
            setShowPwSet(false);
            setPwInput1('');
            setPwInput2('');
        } catch (err) {
            setPwError(err instanceof Error ? err.message : String(err));
        } finally {
            setPwBusy(false);
        }
    };

    const handleClearPassword = async () => {
        if (!pwInput1) { setPwError('Enter the current password'); return; }
        setPwBusy(true);
        setPwError(null);
        try {
            const res = await fetch(`/api/category/${categoryId}/lock`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwInput1 }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error?.toString?.() || `HTTP ${res.status}`);
            }
            setPasswordLocked(false);
            setShowPwClear(false);
            setPwInput1('');
        } catch (err) {
            setPwError(err instanceof Error ? err.message : String(err));
        } finally {
            setPwBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-bg-card border border-border-primary rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
                    <h2 className="text-text-primary font-semibold">
                        {category ? `Settings — ${category.Name}` : 'Category Settings'}
                    </h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {loading && <div className="p-5 text-sm text-text-muted">Loading…</div>}
                {error && (
                    <div className="px-5 pt-4 text-sm text-red-400">{error}</div>
                )}

                {!loading && category && (
                    <div className="p-5 space-y-6 text-sm">
                        <section>
                            <label className="block text-text-muted text-xs uppercase tracking-wider mb-1">Parent category</label>
                            <select
                                value={parentId ?? ''}
                                onChange={e => setParentId(e.target.value ? Number(e.target.value) : null)}
                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                            >
                                <option value="">None (top level)</option>
                                {eligibleParentIds(allCategories, categoryId).map(pid => {
                                    const c = allCategories.find(x => x.CategoryID === pid);
                                    return c ? <option key={pid} value={pid}>{c.Name}</option> : null;
                                })}
                            </select>
                            <p className="text-text-muted text-xs mt-1">
                                Nest this category under another. Shown as a tree in the vertical tabs view (View › Category Tabs Navigation › Vertical).
                            </p>
                        </section>

                        <section>
                            <label className="block text-text-muted text-xs uppercase tracking-wider mb-1">Sort mode</label>
                            <select
                                value={sortMode}
                                onChange={e => setSortMode(e.target.value as SortMode)}
                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                            >
                                {SORT_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                            <p className="text-text-muted text-xs mt-1">
                                Per-category sort. Saved with the category, syncs across browsers and Electron.
                            </p>
                        </section>

                        <section>
                            <label className="block text-text-muted text-xs uppercase tracking-wider mb-1">Auto-apply template</label>
                            <select
                                value={autoTemplateId}
                                onChange={e => setAutoTemplateId(Number(e.target.value))}
                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                            >
                                <option value={0}>(no template)</option>
                                {templates.map(t => (
                                    <option key={t.TemplateID} value={t.TemplateID}>{t.Name}</option>
                                ))}
                            </select>
                            <p className="text-text-muted text-xs mt-1">
                                New entries in this category will be pre-filled with the chosen template.
                            </p>
                        </section>

                        <section>
                            <label className="block text-text-muted text-xs uppercase tracking-wider mb-1">View mode</label>
                            <select
                                value={viewType}
                                onChange={e => setViewType(e.target.value as 'Journal' | 'Notebook')}
                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                            >
                                <option value="Journal">Calendar (date-based journal)</option>
                                <option value="Notebook">Loose-leaf (tree of pages)</option>
                            </select>
                            <p className="text-text-muted text-xs mt-1">
                                Calendar shows entries on a month grid by date; loose-leaf shows a page tree. Entries are not changed.
                            </p>
                        </section>

                        {category.Type === 'Journal' && (
                            <section>
                                <label className="block text-text-muted text-xs uppercase tracking-wider mb-1">Entry frequency</label>
                                <select
                                    value={entryFrequency}
                                    onChange={e => setEntryFrequency(e.target.value as 'daily' | 'weekly' | 'hourly')}
                                    className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                >
                                    <option value="hourly">Hourly</option>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                </select>
                                <p className="text-text-muted text-xs mt-1">
                                    How often a fresh entry is expected. Used by the calendar to highlight missed days.
                                </p>
                            </section>
                        )}

                        <section>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isSmartbook}
                                    onChange={e => setIsSmartbook(e.target.checked)}
                                />
                                <span className="text-text-primary">
                                    Smartbook (auto-collects entries matching a saved query)
                                </span>
                            </label>
                            {isSmartbook && (
                                <div className="mt-3 pl-6 space-y-3 border-l border-border-primary/40">
                                    <div>
                                        <label className="block text-text-muted text-xs mb-1">Search text</label>
                                        <input
                                            type="text"
                                            value={smartbookQuery.q ?? ''}
                                            onChange={e => updateQuery({ q: e.target.value })}
                                            placeholder="leave blank to match all"
                                            className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-text-muted text-xs mb-1">
                                            Tags (comma-separated, AND match)
                                        </label>
                                        <input
                                            type="text"
                                            value={(smartbookQuery.tags ?? []).join(', ')}
                                            onChange={e => updateQuery({
                                                tags: e.target.value
                                                    .split(',')
                                                    .map(t => t.trim().toLowerCase())
                                                    .filter(Boolean),
                                            })}
                                            placeholder="travel, work"
                                            className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-text-muted text-xs mb-1">
                                            Restrict to categories (optional)
                                        </label>
                                        <select
                                            multiple
                                            value={(smartbookQuery.categoryIds ?? []).map(String)}
                                            onChange={e => updateQuery({
                                                categoryIds: Array.from(e.target.selectedOptions)
                                                    .map(o => Number(o.value))
                                                    .filter(n => Number.isFinite(n) && n > 0),
                                            })}
                                            className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary h-32"
                                        >
                                            {allCategories
                                                .filter(c => !c.IsSmartbook && c.CategoryID !== categoryId)
                                                .map(c => (
                                                    <option key={c.CategoryID} value={c.CategoryID}>{c.Name}</option>
                                                ))}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-text-muted text-xs mb-1">From</label>
                                            <input
                                                type="date"
                                                value={smartbookQuery.dateFrom?.substring(0, 10) ?? ''}
                                                onChange={e => updateQuery({ dateFrom: e.target.value || undefined })}
                                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-text-muted text-xs mb-1">To</label>
                                            <input
                                                type="date"
                                                value={smartbookQuery.dateTo?.substring(0, 10) ?? ''}
                                                onChange={e => updateQuery({ dateTo: e.target.value || undefined })}
                                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section>
                            <label className="block text-text-muted text-xs uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Password
                            </label>
                            {passwordLocked ? (
                                <div className="space-y-2">
                                    <p className="text-text-secondary">
                                        This category is password-protected. Entries are encrypted at rest
                                        with AES-256-GCM; forgetting the password makes the content unrecoverable.
                                    </p>
                                    {!showPwClear && (
                                        <button
                                            onClick={() => { setShowPwClear(true); setPwError(null); setPwInput1(''); }}
                                            className="text-xs px-3 py-1 rounded bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20"
                                        >
                                            Remove password (decrypt entries)
                                        </button>
                                    )}
                                    {showPwClear && (
                                        <div className="flex flex-col gap-2">
                                            <input
                                                type="password"
                                                placeholder="Current password"
                                                value={pwInput1}
                                                onChange={e => setPwInput1(e.target.value)}
                                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                            />
                                            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
                                            <div className="flex gap-2 justify-end">
                                                <button onClick={() => { setShowPwClear(false); setPwError(null); setPwInput1(''); }}
                                                    className="px-3 py-1 text-text-muted hover:text-text-primary">Cancel</button>
                                                <button onClick={handleClearPassword} disabled={pwBusy}
                                                    className="px-3 py-1 bg-red-500 text-white rounded disabled:opacity-50">
                                                    {pwBusy ? 'Decrypting…' : 'Remove password'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-text-secondary">
                                        No password set. Entries in this category are not separately encrypted.
                                    </p>
                                    {!showPwSet && (
                                        <button
                                            onClick={() => { setShowPwSet(true); setPwError(null); setPwInput1(''); setPwInput2(''); }}
                                            className="text-xs px-3 py-1 rounded bg-accent-primary/10 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/20"
                                        >
                                            Set a password (encrypt entries)
                                        </button>
                                    )}
                                    {showPwSet && (
                                        <div className="flex flex-col gap-2">
                                            <input
                                                type="password"
                                                placeholder="New password"
                                                value={pwInput1}
                                                onChange={e => setPwInput1(e.target.value)}
                                                autoComplete="new-password"
                                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                            />
                                            <input
                                                type="password"
                                                placeholder="Confirm password"
                                                value={pwInput2}
                                                onChange={e => setPwInput2(e.target.value)}
                                                autoComplete="new-password"
                                                className="w-full bg-bg-sidebar border border-border-primary rounded p-2 text-text-primary"
                                            />
                                            <p className="text-xs text-yellow-400">
                                                There is no recovery option. Losing this password means losing access to encrypted entries.
                                            </p>
                                            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
                                            <div className="flex gap-2 justify-end">
                                                <button onClick={() => { setShowPwSet(false); setPwError(null); setPwInput1(''); setPwInput2(''); }}
                                                    className="px-3 py-1 text-text-muted hover:text-text-primary">Cancel</button>
                                                <button onClick={handleSetPassword} disabled={pwBusy}
                                                    className="px-3 py-1 bg-accent-primary text-white rounded disabled:opacity-50">
                                                    {pwBusy ? 'Encrypting…' : 'Set password'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    </div>
                )}

                <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-primary">
                    <button onClick={onClose} className="px-3 py-1 text-text-muted hover:text-text-primary">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={loading || saving}
                        className="px-3 py-1 bg-accent-primary text-white rounded disabled:opacity-50"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
