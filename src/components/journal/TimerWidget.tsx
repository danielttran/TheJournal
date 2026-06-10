"use client";

import { useEffect, useRef, useState } from 'react';
import { Timer as TimerIcon, Play, Pause, RotateCcw, X } from 'lucide-react';
import { formatElapsed, insertTimerText } from '@/lib/timerFormat';

interface TimerWidgetProps {
    /** Insert the elapsed-time text at the caret. */
    onInsert: (text: string) => void;
    onClose: () => void;
}

/**
 * J8 "Timer" — a small floating stopwatch for timed writing sessions, with
 * Insert Timer (drops the elapsed time into the entry at the caret).
 */
export default function TimerWidget({ onInsert, onClose }: TimerWidgetProps) {
    const [running, setRunning] = useState(true);
    const [elapsedMs, setElapsedMs] = useState(0);
    // Accumulate across pauses: base = elapsed when last paused.
    const baseRef = useRef(0);
    const startedAtRef = useRef<number | null>(Date.now());

    useEffect(() => {
        if (!running) return;
        const tick = () => {
            const startedAt = startedAtRef.current;
            if (startedAt !== null) setElapsedMs(baseRef.current + (Date.now() - startedAt));
        };
        tick();
        const handle = window.setInterval(tick, 500);
        return () => window.clearInterval(handle);
    }, [running]);

    const toggle = () => {
        if (running) {
            const startedAt = startedAtRef.current;
            if (startedAt !== null) baseRef.current += Date.now() - startedAt;
            startedAtRef.current = null;
            setRunning(false);
        } else {
            startedAtRef.current = Date.now();
            setRunning(true);
        }
    };

    const reset = () => {
        baseRef.current = 0;
        startedAtRef.current = running ? Date.now() : null;
        setElapsedMs(0);
    };

    return (
        <div className="fixed bottom-16 right-6 z-[350] flex items-center gap-2 bg-bg-card border border-border-primary rounded-lg shadow-2xl px-3 py-2">
            <TimerIcon className="w-4 h-4 text-text-muted" />
            <span className="text-sm font-mono tabular-nums text-text-primary min-w-[60px]">{formatElapsed(elapsedMs)}</span>
            <button onClick={toggle} className="p-1 rounded hover:bg-bg-hover text-text-muted" title={running ? 'Pause' : 'Resume'}>
                {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button onClick={reset} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Reset">
                <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
                onClick={() => onInsert(insertTimerText(elapsedMs))}
                className="px-2 py-0.5 text-xs rounded bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25"
                title="Insert the elapsed time into the entry"
            >
                Insert
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Close timer">
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}
