"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import 'react-quill-new/dist/quill.snow.css'; // Add css for snow theme

// Dynamic import to avoid SSR issues with Quill
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

import { useSearchParams } from 'next/navigation';

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];

    const [value, setValue] = useState(''); // HTML/Content
    const [entryId, setEntryId] = useState<number | null>(null);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);

    // Debounce Save Logic
    useEffect(() => {
        if (!entryId || !value) return;

        const timer = setTimeout(async () => {
            setSaving(true);
            try {
                // Extract first line as title (simplified logic: remove HTML tags)
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = value;
                const plainText = tempDiv.textContent || tempDiv.innerText || '';
                const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';

                await fetch(`/api/entry/${entryId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        content: { ops: [{ insert: value }] }, // Mock Delta
                        html: value,
                        title: derivedTitle
                    })
                });
                setLastSaved(new Date());
            } catch (err) {
                console.error("Failed to save", err);
            } finally {
                setSaving(false);
            }
        }, 1500); // 1.5s debounce

        return () => clearTimeout(timer);
    }, [value, entryId, userId]); // Removed 'title' dependency

    // Initial Load (Get Entry for selectedDate)
    useEffect(() => {
        const fetchEntry = async () => {
            setValue('');
            setEntryId(null);

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
    }, [categoryId, userId, selectedDate]);

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
                }
                .ql-fill {
                    fill: #9ca3af !important;
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
