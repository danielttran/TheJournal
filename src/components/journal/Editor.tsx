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
                // In a real app, use the Delta object, not just HTML/Value if possible
                // For simplicity here, we assume 'value' is what we want to save (Textarea for now?)
                // Wait, we need to switch back to Quill to get Delta.
                // Let's assume we are passing a mock Delta for now if using Textarea.

                await fetch(`/api/entry/${entryId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        content: { ops: [{ insert: value }] }, // Mock Delta for textarea
                        html: value, // Store raw text as HTML for now
                        title
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
    }, [value, entryId, title, userId]);

    // Initial Load (Get Entry for selectedDate)
    useEffect(() => {
        const fetchEntry = async () => {
            setValue(''); // Reset content while loading
            setEntryId(null); // Reset ID

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
                    setTitle(data.title);
                    // Handle Content
                    // If we have quill delta, ideally we use it. 
                    // But for simple text/html for now:
                    if (data.html) setValue(data.html);
                    // If content is just Delta JSON string, we might tricky things.
                    // For now let's persist HTML or Delta? 
                    // The API saves 'content' as Delta OPS, and 'html' as string.
                    // If we are using Quill, we should pass Delta to 'value' if it supports it, or HTML.
                    // ReactQuill 'value' prop supports HTML string or Delta object.
                    // Let's prefer HTML for simplicity if we stored it, or construct it.
                } else {
                    // If no entry found, reset title and content
                    setTitle('');
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
            {/* Top Toolbar Area */}
            <div className="h-14 border-b border-gray-800 flex items-center justify-between px-6 bg-gray-900">
                <div className="flex items-center space-x-4">
                    <div className="text-gray-400 text-sm">Inter</div>
                    <div className="w-px h-4 bg-gray-700"></div>
                    <div className="text-gray-400 text-sm">11</div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center space-x-3">
                    <span className={`text-xs flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                        {saving ? 'Saving...' : 'Saved'}
                    </span>
                    <button className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded transition-colors">
                        Share
                    </button>
                </div>
            </div>

            {/* Scrollable Editor Area */}
            <div className="flex-1 overflow-y-auto relative">
                <div className="max-w-4xl mx-auto py-12 px-8 min-h-full">
                    {/* Metadata Header */}
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center space-x-2 text-xs text-purple-400 uppercase tracking-widest font-semibold">
                            <span>My Journal</span>
                            <span className="text-gray-600">/</span>
                            <span>{new Date().getFullYear()}</span>
                        </div>

                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full bg-transparent text-5xl font-bold text-white placeholder-gray-700 outline-none"
                            placeholder="Entry Title"
                        />
                    </div>

                    {/* Quill Editor */}
                    <div className="prose prose-invert max-w-none text-lg leading-relaxed text-gray-300 editor-override h-full">
                        <ReactQuill
                            theme="snow"
                            value={value}
                            onChange={setValue}
                            modules={modules}
                            className="bg-transparent border-none h-full"
                            placeholder="Start writing..."
                        />
                    </div>
                </div>
            </div>

            <style jsx global>{`
                /* Custom overrides to match the dark theme aesthetics */
                .ql-toolbar {
                    border: none !important;
                    border-bottom: 1px solid #1f2937 !important;
                    background: #111827;
                    color: #fff;
                    position: sticky;
                    top: 0;
                    z-index: 50;
                }
                .ql-container {
                    border: none !important;
                    font-size: 1.125rem;
                    height: calc(100% - 42px); /* Subtract toolbar height approx */
                    overflow-y: hidden; /* Let child scroll or container scroll? react-quill is weird */
                }
                .ql-editor {
                    height: 100%;
                    overflow-y: auto;
                    padding: 0 !important;
                }
                .ql-editor p {
                    color: #d1d5db;
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
