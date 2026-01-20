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
            <div className="bg-bg-card border border-border-primary rounded-3xl p-8 hover:shadow-2xl hover:border-accent-primary transition-all duration-300 h-full">
                <div className="w-16 h-16 bg-accent-secondary/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-accent-primary" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">Import Backup</h2>
                <p className="text-text-secondary">
                    Restore your journal from an existing database file (.db or .sqlite).
                </p>
            </div>
        </div>
    );
}
