"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, X, Book, FileText } from 'lucide-react';

interface Category {
    CategoryID: number;
    Name: string;
    Type: 'Journal' | 'Notebook';
    Color: string;
}

export default function TabBar({ userId }: { userId: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const [tabs, setTabs] = useState<Category[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Modal State
    const [newTabName, setNewTabName] = useState('');
    const [newTabType, setNewTabType] = useState<'Journal' | 'Notebook'>('Journal');

    useEffect(() => {
        fetchTabs();
    }, []);

    const fetchTabs = async () => {
        try {
            const res = await fetch('/api/category'); // Will need to update API to return all or specific list
            const data = await res.json();
            if (Array.isArray(data)) {
                setTabs(data);
            }
        } catch (error) {
            console.error("Failed to load tabs", error);
        }
    };

    const handleCreateTab = async () => {
        try {
            const res = await fetch('/api/category', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newTabName,
                    type: newTabType,
                    userId // Should be handled by session usually, but passing for now if API expects it request body or auth header
                })
            });
            const newCat = await res.json();
            if (newCat.id) {
                setTabs([...tabs, { CategoryID: newCat.id, Name: newTabName, Type: newTabType, Color: '#fff' }]);
                setIsModalOpen(false);
                setNewTabName('');
                router.push(`/journal/${newCat.id}`);
            }
        } catch (error) {
            console.error("Failed to create tab", error);
        }
    };

    // Extract active CategoryID from pathname
    const activeId = pathname.split('/')[2];

    return (
        <div className="flex flex-col w-full bg-[#1e1e1e] border-b border-[#333]">
            {/* Top Menu Bar (Visual Only) */}
            <div className="flex items-center px-4 py-1 space-x-4 bg-[#2d2d2d] text-xs text-gray-300 select-none">
                <div className="w-6 h-6 bg-purple-600 rounded flex items-center justify-center font-bold text-white mr-2">J</div>
                <span className="hover:bg-gray-700 px-2 py-0.5 rounded cursor-pointer">File</span>
                <span className="hover:bg-gray-700 px-2 py-0.5 rounded cursor-pointer">Edit</span>
                <span className="hover:bg-gray-700 px-2 py-0.5 rounded cursor-pointer">View</span>
                <span className="hover:bg-gray-700 px-2 py-0.5 rounded cursor-pointer">Tools</span>
            </div>

            {/* Tab Strip */}
            <div className="flex items-center px-2 pt-2 space-x-1 overflow-x-auto no-scrollbar bg-[#1e1e1e]">
                {tabs.map(tab => {
                    const isActive = activeId === String(tab.CategoryID);
                    return (
                        <div
                            key={tab.CategoryID}
                            onClick={() => router.push(`/journal/${tab.CategoryID}`)}
                            className={`
                                group flex items-center min-w-[120px] max-w-[200px] h-9 px-3 rounded-t-lg text-sm cursor-pointer select-none transition-colors
                                ${isActive ? 'bg-[#111827] text-white' : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#333]'}
                            `}
                        >
                            {tab.Type === 'Journal' ? <Book className="w-3.5 h-3.5 mr-2 opacity-70" /> : <FileText className="w-3.5 h-3.5 mr-2 opacity-70" />}
                            <span className="truncate flex-1">{tab.Name}</span>
                            <span className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-600 rounded ml-2">
                                <X className="w-3 h-3" />
                            </span>
                        </div>
                    );
                })}

                {/* New Tab Button */}
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="h-8 w-8 flex items-center justify-center text-gray-400 hover:bg-[#333] rounded hover:text-white transition-colors"
                >
                    <Plus className="w-5 h-5" />
                </button>
            </div>

            {/* Create Tab Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-[#2d2d2d] p-6 rounded-lg w-96 border border-[#444] shadow-xl">
                        <h3 className="text-lg font-semibold text-white mb-4">Create New Tab</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={newTabName}
                                    onChange={e => setNewTabName(e.target.value)}
                                    className="w-full bg-[#1e1e1e] border border-[#444] rounded p-2 text-white focus:outline-none focus:border-purple-500"
                                    placeholder="e.g. Work, Personal..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setNewTabType('Journal')}
                                        className={`p-3 rounded border text-sm flex flex-col items-center justify-center space-y-2
                                            ${newTabType === 'Journal' ? 'bg-purple-900/50 border-purple-500 text-white' : 'bg-[#1e1e1e] border-[#444] text-gray-400 hover:bg-[#333]'}
                                        `}
                                    >
                                        <Book className="w-6 h-6" />
                                        <span>Journal</span>
                                    </button>
                                    <button
                                        onClick={() => setNewTabType('Notebook')}
                                        className={`p-3 rounded border text-sm flex flex-col items-center justify-center space-y-2
                                            ${newTabType === 'Notebook' ? 'bg-purple-900/50 border-purple-500 text-white' : 'bg-[#1e1e1e] border-[#444] text-gray-400 hover:bg-[#333]'}
                                        `}
                                    >
                                        <FileText className="w-6 h-6" />
                                        <span>Notebook</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end space-x-2">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 text-gray-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateTab}
                                disabled={!newTabName}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
