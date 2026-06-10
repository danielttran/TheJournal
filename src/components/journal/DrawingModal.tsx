"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import {
    ReactSketchCanvas,
    type ReactSketchCanvasRef,
    type CanvasPath,
} from 'react-sketch-canvas';
import { X, Check, Loader, Undo, Redo, Eraser, Pencil, Trash2 } from 'lucide-react';
import { buildDrawingSvg } from '@/lib/drawing';

interface DrawingModalProps {
    /** Existing drawing's editable paths, when editing an inserted drawing. */
    initialPaths?: CanvasPath[] | null;
    /**
     * J8 "doodle on a photograph": draw over this image instead of a blank
     * canvas. The save composites strokes onto the photo (PNG), so the result
     * replaces the original image node.
     */
    backgroundImage?: string | null;
    /** Receives the uploaded attachment URL of the saved SVG / annotated PNG. */
    onConfirm: (url: string) => void;
    onClose: () => void;
}

/** data:image/png;base64,... → Blob (exportImage returns a data URL). */
function dataUrlToBlob(dataUrl: string): Blob {
    const [head, body] = dataUrl.split(',');
    const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

const PALETTE = ['#111827', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];

export default function DrawingModal({ initialPaths, backgroundImage, onConfirm, onClose }: DrawingModalProps) {
    const canvasRef = useRef<ReactSketchCanvasRef>(null);
    const [strokeColor, setStrokeColor] = useState('#111827');
    const [strokeWidth, setStrokeWidth] = useState(4);
    const [isEraser, setIsEraser] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load an existing drawing's strokes for editing.
    useEffect(() => {
        if (initialPaths && initialPaths.length > 0) {
            // Defer so the canvas has mounted before loadPaths runs.
            const t = setTimeout(() => canvasRef.current?.loadPaths(initialPaths), 50);
            return () => clearTimeout(t);
        }
    }, [initialPaths]);

    const toggleEraser = useCallback((on: boolean) => {
        setIsEraser(on);
        canvasRef.current?.eraseMode(on);
    }, []);

    const handleSave = useCallback(async () => {
        if (!canvasRef.current) return;
        setIsSaving(true);
        setError(null);
        try {
            const paths = await canvasRef.current.exportPaths();
            if (!paths || paths.length === 0) {
                setError('Nothing to save — draw something first.');
                setIsSaving(false);
                return;
            }
            let file: File;
            if (backgroundImage) {
                // Annotation mode: composite strokes onto the photo as a PNG.
                const dataUrl = await canvasRef.current.exportImage('png');
                file = new File([dataUrlToBlob(dataUrl)], 'annotated.png', { type: 'image/png' });
            } else {
                const rawSvg = await canvasRef.current.exportSvg();
                const svg = buildDrawingSvg(rawSvg, paths);
                file = new File([svg], 'drawing.svg', { type: 'image/svg+xml' });
            }
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
            onConfirm(data.url as string);
        } catch (e) {
            console.error('[DrawingModal] save failed:', e);
            setError(backgroundImage
                ? 'Could not save the annotation (cross-origin images are read-only).'
                : 'Could not save the drawing. Please try again.');
            setIsSaving(false);
        }
    }, [onConfirm, backgroundImage]);

    return (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
                    <h2 className="text-text-primary font-semibold">
                        {backgroundImage ? 'Doodle on image' : initialPaths && initialPaths.length > 0 ? 'Edit drawing' : 'New drawing'}
                    </h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Close">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border-primary bg-bg-sidebar">
                    <div className="flex items-center gap-1">
                        {PALETTE.map(c => (
                            <button
                                key={c}
                                onClick={() => { setStrokeColor(c); toggleEraser(false); }}
                                className={`w-5 h-5 rounded-full border ${strokeColor === c && !isEraser ? 'ring-2 ring-[color:var(--color-accent-primary)]' : 'border-border-primary'}`}
                                style={{ backgroundColor: c }}
                                title={c}
                            />
                        ))}
                        <input
                            type="color"
                            value={strokeColor}
                            onChange={e => { setStrokeColor(e.target.value); toggleEraser(false); }}
                            className="w-6 h-6 p-0 border border-border-primary rounded cursor-pointer"
                            title="Custom colour"
                        />
                    </div>

                    <div className="w-px h-5 bg-border-primary mx-1" />

                    <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        Size
                        <input
                            type="range" min={1} max={30} value={strokeWidth}
                            onChange={e => setStrokeWidth(Number(e.target.value))}
                            className="w-24 accent-[color:var(--color-accent-primary)]"
                        />
                        <span className="tabular-nums w-5 text-text-muted">{strokeWidth}</span>
                    </label>

                    <div className="w-px h-5 bg-border-primary mx-1" />

                    <button
                        onClick={() => toggleEraser(false)}
                        className={`p-1.5 rounded hover:bg-bg-hover ${!isEraser ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                        title="Pen"
                    >
                        <Pencil className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => toggleEraser(true)}
                        className={`p-1.5 rounded hover:bg-bg-hover ${isEraser ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                        title="Eraser"
                    >
                        <Eraser className="w-4 h-4" />
                    </button>
                    <button onClick={() => canvasRef.current?.undo()} className="p-1.5 rounded hover:bg-bg-hover text-text-muted" title="Undo">
                        <Undo className="w-4 h-4" />
                    </button>
                    <button onClick={() => canvasRef.current?.redo()} className="p-1.5 rounded hover:bg-bg-hover text-text-muted" title="Redo">
                        <Redo className="w-4 h-4" />
                    </button>
                    <button onClick={() => canvasRef.current?.clearCanvas()} className="p-1.5 rounded hover:bg-bg-hover text-red-400" title="Clear">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-4 overflow-auto flex-1 bg-bg-app">
                    <ReactSketchCanvas
                        ref={canvasRef}
                        width="100%"
                        height="420px"
                        strokeColor={strokeColor}
                        strokeWidth={strokeWidth}
                        eraserWidth={strokeWidth * 3}
                        canvasColor={backgroundImage ? 'transparent' : '#ffffff'}
                        backgroundImage={backgroundImage ?? undefined}
                        preserveBackgroundImageAspectRatio="xMidYMid meet"
                        exportWithBackgroundImage={!!backgroundImage}
                        style={{ borderRadius: 8, border: '1px solid var(--border-primary)' }}
                    />
                </div>

                <div className="flex items-center justify-between px-4 py-3 border-t border-border-primary">
                    <span className="text-xs text-red-400">{error}</span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Cancel</button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-3 py-1.5 text-sm bg-accent-primary text-white rounded hover:bg-opacity-90 flex items-center gap-1.5 disabled:opacity-60"
                        >
                            {isSaving ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Save drawing
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
