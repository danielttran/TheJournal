"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';
import 'react-quill-new/dist/quill.snow.css'; // Add css for snow theme
import { useSearchParams } from 'next/navigation';

// Dynamic import to avoid SSR issues with Quill
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const [value, setValue] = useState(''); // HTML/Content
    const [entryId, setEntryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const valueRef = useRef(value); // Tracking for unmount save
    const entryIdRef = useRef(entryId); // Tracking for unmount save

    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    useEffect(() => {
        entryIdRef.current = entryId;
    }, [entryId]);

    // Save Function
    const saveContent = async (id: number, content: string) => {
        setSaving(true);
        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
            // Limit preview to ~200 chars
            const derivedPreview = plainText.substring(0, 200);

            await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    content: { ops: [{ insert: content }] },
                    html: content,
                    title: derivedTitle,
                    preview: derivedPreview
                })
            });
        } catch (err) {
            console.error("Failed to save", err);
        } finally {
            setSaving(false);
            window.dispatchEvent(new CustomEvent('journal-entry-updated'));
        }
    };

    // Debounce Save Logic
    useEffect(() => {
        if (!entryId || !value) return;

        const timer = setTimeout(() => {
            saveContent(entryId, value);
        }, 1500);

        return () => clearTimeout(timer);
    }, [value, entryId, userId]);

    // Initial Load & Unmount Save Logic
    useEffect(() => {
        // If we are switching FROM an entry, save it immediately
        const previousEntryId = entryIdRef.current;
        const previousValue = valueRef.current;

        if (previousEntryId && previousValue) {
            saveContent(previousEntryId, previousValue);
        }

        const fetchEntry = async () => {
            setValue('');
            setEntryId(null);

            // Prioritize URL Entry ID (Notebook Mode)
            if (urlEntryId) {
                try {
                    const res = await fetch(`/api/entry/${urlEntryId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.EntryID) {
                            setEntryId(data.EntryID);
                            if (data.HtmlContent) setValue(data.HtmlContent);
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
                return;
            }

            try {
                const res = await fetch('/api/entry/by-date', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: selectedDate,
                        categoryId,
                        userId
                    })
                });
                const data = await res.json();
                if (data.id) {
                    setEntryId(data.id);
                    if (data.html) setValue(data.html);
                } else {
                    setValue('');
                }
            } catch (err) {
                console.error("Failed to load entry", err);
            }
        };
        fetchEntry();
    }, [categoryId, userId, selectedDate, urlEntryId]);

    // Modules for custom toolbar
    const modules = {
        toolbar: [
            [{ 'header': [1, 2, false] }],
            ['bold', 'italic', 'underline', 'strike', 'blockquote'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
            ['link', 'image'],
            ['clean']
        ],
    };

    return (
        <div className="flex flex-col h-full bg-gray-900">
            {/* Top Toolbar Status Only */}
            <div className="h-8 border-b border-gray-800 flex items-center justify-end px-4 bg-gray-900 absolute top-0 right-0 z-50 pointer-events-none">
                {/* Status Indicator floating */}
                <span className={`text-xs flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                    {saving ? 'Saving...' : 'Saved'}
                </span>
            </div>

            {/* Editor Area - Toolbar will be injected by Quill at top */}
            <div className="flex-1 overflow-hidden relative flex flex-col">
                <ReactQuill
                    key={entryId || 'empty'}
                    theme="snow"
                    value={value}
                    onChange={setValue}
                    modules={modules}
                    className="flex-1 flex flex-col bg-transparent border-none"
                    placeholder="Start writing..."
                />
            </div>

            <style jsx global>{`
                /* Custom overrides to match the dark theme aesthetics */
                .ql-toolbar {
                    border: none !important;
                    border-bottom: 1px solid #1f2937 !important;
                    background: #111827;
                    color: #fff;
                    padding: 12px 24px !important;
                }
                .ql-container {
                    border: none !important;
                    font-size: 1.125rem;
                    flex: 1;
                    overflow: hidden; 
                    display: flex;
                    flex-direction: column;
                }
                .ql-editor {
                    flex: 1;
                    overflow-y: auto;
                    padding: 2rem 4rem !important; /* Spacious padding */
                    color: #d1d5db;
                }
                .ql-editor p {
                     margin-bottom: 0.8em;
                     line-height: 1.6;
                }
                .ql-stroke {
                    stroke: #9ca3af !important;
                    fill: none !important; /* Ensure stroke doesn't have fill */
                }
                .ql-fill {
                    fill: #9ca3af !important;
                    stroke: none !important; /* Ensure fill doesn't have stroke */
                }
                /* Specific SVGs might need specific targeting, but general rule helps */
                .ql-picker {
                    color: #9ca3af;
                }
                .quill {
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
            `}</style>
        </div>
    );
}
