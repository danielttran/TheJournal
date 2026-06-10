"use client";

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, X } from 'lucide-react';

interface VoiceMemo {
    AttachmentID: number;
    Filename: string;
    MimeType: string;
    Size: number;
    CreatedAt: string;
}

interface Props { onClose: () => void; }

/**
 * Tools ▸ Voice Memos (J8 audio entries). Records via MediaRecorder, stores
 * through /api/audio, lists + plays + deletes existing memos.
 */
export default function VoiceMemosPanel({ onClose }: Props) {
    const [memos, setMemos] = useState<VoiceMemo[]>([]);
    const [loading, setLoading] = useState(true);
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    // Guards the getUserMedia await: if the panel closes while the permission
    // prompt is up, the resolved stream must be stopped, not left recording.
    const unmountedRef = useRef(false);

    const reload = async (signal?: AbortSignal) => {
        try {
            const res = await fetch('/api/audio', { signal });
            if (res.ok) {
                const d = await res.json();
                if (!signal?.aborted) setMemos(d.memos ?? []);
            }
        } catch { /* offline */ }
        if (!signal?.aborted) setLoading(false);
    };

    useEffect(() => {
        const ctl = new AbortController();
        void reload(ctl.signal);
        return () => {
            ctl.abort();
            unmountedRef.current = true;
            // Stop a recording left running when the panel closes.
            if (recorderRef.current?.state === 'recording') {
                recorderRef.current.stream.getTracks().forEach(t => t.stop());
                recorderRef.current.stop();
            }
        };
    }, []);

    const startRecording = async () => {
        setError(null);
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setError('Recording is not supported in this browser.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (unmountedRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const type = recorder.mimeType || 'audio/webm';
                const blob = new Blob(chunksRef.current, { type });
                if (blob.size === 0) return;
                const fd = new FormData();
                const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
                fd.append('file', new File([blob], `memo-${Date.now()}.${ext}`, { type }));
                const res = await fetch('/api/audio', { method: 'POST', body: fd });
                if (!res.ok) setError('Could not save the recording.');
                void reload();
            };
            recorderRef.current = recorder;
            recorder.start();
            setRecording(true);
        } catch {
            setError('Microphone access was denied.');
        }
    };

    const stopRecording = () => {
        recorderRef.current?.stop();
        setRecording(false);
    };

    const remove = async (id: number) => {
        if (!confirm('Delete this voice memo?')) return;
        await fetch(`/api/audio/${id}`, { method: 'DELETE' });
        void reload();
    };

    const fmtSize = (n: number) => n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[560px] max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Voice Memos</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {recording ? (
                            <button onClick={stopRecording} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-red-500 text-white rounded hover:opacity-90">
                                <Square className="w-3 h-3" /> Stop
                            </button>
                        ) : (
                            <button onClick={() => void startRecording()} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-accent-primary text-white rounded hover:opacity-90">
                                <Mic className="w-3 h-3" /> Record
                            </button>
                        )}
                        <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                {recording && (
                    <div className="px-4 py-2 text-xs text-red-400 border-b border-border-primary flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Recording…
                    </div>
                )}
                {error && <div className="px-4 py-2 text-xs text-red-400 border-b border-border-primary">{error}</div>}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {loading && <div className="text-center text-text-muted py-6">Loading…</div>}
                    {!loading && memos.length === 0 && (
                        <div className="text-center text-text-muted py-10">
                            <Mic className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <p className="text-sm">No voice memos yet.</p>
                            <p className="text-xs mt-1 opacity-70">Record spoken notes alongside your written entries.</p>
                        </div>
                    )}
                    {!loading && memos.map(m => (
                        <div key={m.AttachmentID} className="flex items-center gap-3 p-2 border border-border-primary rounded bg-bg-sidebar">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-text-primary truncate">{m.Filename}</div>
                                <div className="text-[10px] text-text-muted">{m.CreatedAt?.slice(0, 16).replace('T', ' ')} · {fmtSize(m.Size)}</div>
                                <audio controls preload="none" src={`/api/audio/${m.AttachmentID}`} className="w-full h-8 mt-1" />
                            </div>
                            <button onClick={() => void remove(m.AttachmentID)} className="p-1 hover:bg-bg-card rounded text-red-400 flex-shrink-0" title="Delete memo">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
