"use client";

import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Pencil, Check, FileText } from 'lucide-react';

export interface Template {
    TemplateID: number;
    Name: string;
    HtmlContent: string;
    DocumentJson?: string | null;
}

interface TemplatePickerProps {
    /** Called when the user picks a template (null = blank). */
    onSelect: (template: Template | null) => void;
    onClose: () => void;
    /** If provided, shows a "Save current as template" flow. */
    currentHtml?: string;
    currentDocumentJson?: any;
}

export default function TemplatePicker({ onSelect, onClose, currentHtml, currentDocumentJson }: TemplatePickerProps) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [savingName, setSavingName] = useState('');
    const [showSaveInput, setShowSaveInput] = useState(false);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const saveInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch('/api/template')
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setTemplates(data);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (renamingId !== null && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingId]);

    useEffect(() => {
        if (showSaveInput && saveInputRef.current) {
            saveInputRef.current.focus();
        }
    }, [showSaveInput]);

    const handleDelete = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Delete this template?')) return;
        const res = await fetch(`/api/template/${id}`, { method: 'DELETE' });
        if (res.ok) setTemplates(prev => prev.filter(t => t.TemplateID !== id));
    };

    const startRename = (t: Template, e: React.MouseEvent) => {
        e.stopPropagation();
        setRenamingId(t.TemplateID);
        setRenameValue(t.Name);
    };

    const submitRename = async (id: number) => {
        const trimmed = renameValue.trim();
        if (!trimmed) { setRenamingId(null); return; }
        const res = await fetch(`/api/template/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed }),
        });
        if (res.ok) {
            setTemplates(prev => prev.map(t => t.TemplateID === id ? { ...t, Name: trimmed } : t));
        }
        setRenamingId(null);
    };

    const handleSaveAsTemplate = async () => {
        const name = savingName.trim();
        if (!name) return;
        const res = await fetch('/api/template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, htmlContent: currentHtml || '', documentJson: currentDocumentJson }),
        });
        if (res.ok) {
            const data = await res.json();
            const newTemplate: Template = {
                TemplateID: data.id,
                Name: name,
                HtmlContent: currentHtml || '',
                DocumentJson: currentDocumentJson ? JSON.stringify(currentDocumentJson) : null,
            };
            setTemplates(prev => [...prev, newTemplate].sort((a, b) => a.Name.localeCompare(b.Name)));
        }
        setSavingName('');
        setShowSaveInput(false);
    };

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-bg-card border border-border-primary rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
                    <h2 className="font-semibold text-text-primary text-base">Choose a template</h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Template grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="text-center py-8 text-text-muted text-sm">Loading templates…</div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            {/* Blank card always first */}
                            <button
                                onClick={() => onSelect(null)}
                                className="group flex flex-col items-center justify-center border-2 border-dashed border-border-primary rounded-lg p-5 hover:border-accent-primary hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
                            >
                                <FileText className="w-8 h-8 mb-2 opacity-40 group-hover:opacity-70" />
                                <span className="text-sm font-medium">Blank</span>
                            </button>

                            {templates.map(t => (
                                <div
                                    key={t.TemplateID}
                                    onClick={() => renamingId !== t.TemplateID && onSelect(t)}
                                    className="group relative border border-border-primary rounded-lg p-4 hover:border-accent-primary hover:bg-bg-hover transition-colors cursor-pointer flex flex-col"
                                >
                                    {/* Preview snippet — safe text extraction, no HTML injection */}
                                    <div className="text-xs text-text-muted mb-2 line-clamp-3 leading-relaxed select-none pointer-events-none flex-1">
                                        {t.HtmlContent
                                            ? (() => { const d = document.createElement('div'); d.innerHTML = t.HtmlContent; return (d.textContent || '').substring(0, 120); })()
                                            : <em>Empty template</em>
                                        }
                                    </div>

                                    {/* Name / rename input */}
                                    {renamingId === t.TemplateID ? (
                                        <div className="flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
                                            <input
                                                ref={renameInputRef}
                                                value={renameValue}
                                                onChange={e => setRenameValue(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') submitRename(t.TemplateID);
                                                    if (e.key === 'Escape') setRenamingId(null);
                                                }}
                                                className="flex-1 text-xs border border-accent-primary rounded px-1.5 py-0.5 bg-bg-active text-text-primary focus:outline-none"
                                            />
                                            <button onClick={() => submitRename(t.TemplateID)} className="p-0.5 text-accent-primary hover:text-accent-primary/80">
                                                <Check className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <span className="text-sm font-medium text-text-primary truncate">{t.Name}</span>
                                    )}

                                    {/* Action buttons — appear on hover */}
                                    {renamingId !== t.TemplateID && (
                                        <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
                                            <button
                                                onClick={e => startRename(t, e)}
                                                className="p-1 rounded bg-bg-card hover:bg-bg-active text-text-muted hover:text-text-primary"
                                                title="Rename"
                                            >
                                                <Pencil className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={e => handleDelete(t.TemplateID, e)}
                                                className="p-1 rounded bg-bg-card hover:bg-red-500/20 text-text-muted hover:text-red-400"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && templates.length === 0 && (
                        <p className="text-center text-text-muted text-sm mt-4">
                            No templates yet. Save the current entry as a template to get started.
                        </p>
                    )}
                </div>

                {/* Footer — save current as template (only when content is available) */}
                {currentHtml !== undefined && (
                    <div className="px-5 py-3 border-t border-border-primary">
                        {showSaveInput ? (
                            <div className="flex items-center gap-2">
                                <input
                                    ref={saveInputRef}
                                    value={savingName}
                                    onChange={e => setSavingName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') handleSaveAsTemplate();
                                        if (e.key === 'Escape') setShowSaveInput(false);
                                    }}
                                    placeholder="Template name…"
                                    className="flex-1 text-sm border border-border-primary rounded px-2 py-1.5 bg-bg-active text-text-primary focus:outline-none focus:border-accent-primary"
                                />
                                <button
                                    onClick={handleSaveAsTemplate}
                                    disabled={!savingName.trim()}
                                    className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Save
                                </button>
                                <button onClick={() => setShowSaveInput(false)} className="p-1.5 rounded hover:bg-bg-hover text-text-muted">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowSaveInput(true)}
                                className="flex items-center gap-1.5 text-sm text-text-muted hover:text-accent-primary transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Save current entry as template
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
