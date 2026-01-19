"use client";

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

export default function ImportCard() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm("Caution: This will overwrite your current journal data. Proceed?")) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/backup/import', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (res.ok) {
                alert("Import successful. Reloading...");
                window.location.reload();
            } else {
                alert("Import failed: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            console.error(err);
            alert("Error importing file.");
        }
    };

    return (
        <div
            onClick={handleClick}
            className="group cursor-pointer h-full"
        >
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".db,.sqlite"
                onChange={handleFileChange}
            />
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 hover:shadow-2xl hover:border-green-500 dark:hover:border-green-500 transition-all duration-300 h-full">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">Import Backup</h2>
                <p className="text-gray-500 dark:text-gray-400">
                    Restore your journal from an existing database file (.db or .sqlite).
                </p>
            </div>
        </div>
    );
}
