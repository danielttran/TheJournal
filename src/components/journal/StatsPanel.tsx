"use client";

import { useEffect, useState } from 'react';
import { BarChart3, X, Flame, FileText, Type } from 'lucide-react';

interface DayBucket { date: string; count: number; words: number; }
interface StatsResponse {
    totals: { entries: number; words: number };
    streaks: { longest: number; current: number };
    series: DayBucket[];
    topTags: { tag: string; count: number }[];
    topMoods: { mood: string; count: number }[];
}
interface TimeOfDayResponse {
    byHour:    { hour: number;    count: number }[];
    byWeekday: { weekday: number; count: number }[];
}
interface MoodTimelineResponse {
    months: number;
    timeline: { month: string; counts: Record<string, number>; total: number }[];
}
interface HeatmapResponse {
    year: number;
    cells: { date: string; entryCount: number; wordCount: number; intensity: 0 | 1 | 2 | 3 | 4 }[];
}

interface Props { onClose: () => void; }

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function StatsPanel({ onClose }: Props) {
    const [data, setData]   = useState<StatsResponse | null>(null);
    const [tod, setTod]     = useState<TimeOfDayResponse | null>(null);
    const [mood, setMood]   = useState<MoodTimelineResponse | null>(null);
    const [heat, setHeat]   = useState<HeatmapResponse | null>(null);
    const [heatYear, setHeatYear] = useState(() => new Date().getFullYear());

    useEffect(() => {
        const ctl = new AbortController();
        const opts = { signal: ctl.signal };
        // Parallel fetches — they're independent and the panel doesn't
        // need any one before showing the others.
        fetch('/api/stats?days=30',           opts).then(r => r.json()).then(d => { if (!ctl.signal.aborted) setData(d); })
            .catch(err => { if (err?.name !== 'AbortError') throw err; });
        fetch('/api/stats/time-of-day',       opts).then(r => r.json()).then(d => { if (!ctl.signal.aborted) setTod(d); })
            .catch(err => { if (err?.name !== 'AbortError') throw err; });
        fetch('/api/stats/mood-timeline?months=12', opts).then(r => r.json()).then(d => { if (!ctl.signal.aborted) setMood(d); })
            .catch(err => { if (err?.name !== 'AbortError') throw err; });
        return () => ctl.abort();
    }, []);

    useEffect(() => {
        const ctl = new AbortController();
        fetch(`/api/stats/heatmap?year=${heatYear}`, { signal: ctl.signal })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!ctl.signal.aborted && d && Array.isArray(d.cells)) setHeat(d); })
            .catch(err => { if (err?.name !== 'AbortError') throw err; });
        return () => ctl.abort();
    }, [heatYear]);

    const maxCount    = data ? Math.max(1, ...data.series.map(s => s.count)) : 1;
    const maxHour     = tod  ? Math.max(1, ...tod.byHour.map(b => b.count))    : 1;
    const maxWeekday  = tod  ? Math.max(1, ...tod.byWeekday.map(b => b.count)) : 1;
    const maxMoodMon  = mood ? Math.max(1, ...mood.timeline.map(m => m.total)) : 1;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[760px] max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Statistics</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                {!data ? (
                    <div className="p-8 text-center text-text-muted">Loading…</div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 space-y-5">
                        <div className="grid grid-cols-4 gap-3">
                            <Stat icon={<FileText className="w-4 h-4" />} label="Entries" value={data.totals.entries.toLocaleString()} />
                            <Stat icon={<Type className="w-4 h-4" />} label="Words" value={data.totals.words.toLocaleString()} />
                            <Stat icon={<Flame className="w-4 h-4" />} label="Current streak" value={`${data.streaks.current}d`} />
                            <Stat icon={<Flame className="w-4 h-4" />} label="Longest streak" value={`${data.streaks.longest}d`} />
                        </div>

                        <div>
                            <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Entries per day (last 30)</h3>
                            <div className="flex items-end gap-0.5 h-32 bg-bg-sidebar rounded p-2">
                                {data.series.map(d => {
                                    const h = (d.count / maxCount) * 100;
                                    return (
                                        <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                                            <div
                                                className={`w-full ${d.count > 0 ? 'bg-accent-primary' : 'bg-border-primary'} rounded-t transition-all`}
                                                style={{ height: `${h}%` }}
                                            />
                                            <div className="absolute bottom-full mb-1 px-1.5 py-0.5 rounded bg-bg-card border border-border-primary text-[10px] text-text-primary opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                                                {d.date}: {d.count} · {d.words}w
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Year activity heatmap — writing density, GitHub-style */}
                        {heat && (
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-xs uppercase tracking-wider text-text-muted">Writing activity</h3>
                                    <div className="flex items-center gap-1 text-xs text-text-muted">
                                        <button
                                            onClick={() => setHeatYear(y => Math.max(1900, y - 1))}
                                            disabled={heatYear <= 1900}
                                            className="px-1.5 py-0.5 rounded hover:bg-bg-hover disabled:opacity-30"
                                            title="Previous year"
                                        >‹</button>
                                        <span className="tabular-nums text-text-primary">{heat.year}</span>
                                        <button
                                            onClick={() => setHeatYear(y => y + 1)}
                                            disabled={heatYear >= new Date().getFullYear()}
                                            className="px-1.5 py-0.5 rounded hover:bg-bg-hover disabled:opacity-30"
                                            title="Next year"
                                        >›</button>
                                    </div>
                                </div>
                                <div className="bg-bg-sidebar rounded p-2 overflow-x-auto">
                                    <div className="grid grid-flow-col grid-rows-7 gap-[2px] w-max">
                                        {heat.cells.map(c => (
                                            <div
                                                key={c.date}
                                                className="w-[9px] h-[9px] rounded-[2px]"
                                                style={{
                                                    background: c.intensity === 0
                                                        ? 'var(--color-border-primary, #333)'
                                                        : `color-mix(in srgb, var(--color-accent-primary) ${25 * c.intensity}%, transparent)`,
                                                }}
                                                title={`${c.date}: ${c.entryCount} ${c.entryCount === 1 ? 'entry' : 'entries'} · ${c.wordCount}w`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Time-of-day distributions — David RM "when do you write?" */}
                        {tod && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">By hour of day</h3>
                                    <div className="flex items-end gap-0.5 h-24 bg-bg-sidebar rounded p-2">
                                        {tod.byHour.map(b => (
                                            <div key={b.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                                                <div
                                                    className={`w-full ${b.count > 0 ? 'bg-accent-primary' : 'bg-border-primary'} rounded-t`}
                                                    style={{ height: `${(b.count / maxHour) * 100}%` }}
                                                />
                                                <div className="absolute bottom-full mb-1 px-1.5 py-0.5 rounded bg-bg-card border border-border-primary text-[10px] text-text-primary opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                                                    {String(b.hour).padStart(2, '0')}:00 · {b.count}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-between text-[10px] text-text-muted mt-1 px-1">
                                        <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">By weekday</h3>
                                    <div className="flex items-end gap-1 h-24 bg-bg-sidebar rounded p-2">
                                        {tod.byWeekday.map(b => (
                                            <div key={b.weekday} className="flex-1 flex flex-col items-center justify-end h-full">
                                                <div
                                                    className={`w-full ${b.count > 0 ? 'bg-accent-primary' : 'bg-border-primary'} rounded-t`}
                                                    style={{ height: `${(b.count / maxWeekday) * 100}%` }}
                                                    title={`${WEEKDAY_LABELS[b.weekday]}: ${b.count}`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-between text-[10px] text-text-muted mt-1 px-1">
                                        {WEEKDAY_LABELS.map(l => <span key={l}>{l}</span>)}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Mood timeline — David RM "mood over time" */}
                        {mood && mood.timeline.some(m => m.total > 0) && (
                            <div>
                                <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Mood timeline (last {mood.months} months)</h3>
                                <div className="flex items-end gap-1 h-28 bg-bg-sidebar rounded p-2">
                                    {mood.timeline.map(m => (
                                        <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                                            <div
                                                className="w-full bg-accent-primary rounded-t"
                                                style={{ height: `${(m.total / maxMoodMon) * 100}%` }}
                                            />
                                            <div className="absolute bottom-full mb-1 px-1.5 py-0.5 rounded bg-bg-card border border-border-primary text-[10px] text-text-primary opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                                                {m.month}: {Object.entries(m.counts).map(([k, v]) => `${k} ${v}`).join(' · ') || `${m.total}`}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between text-[10px] text-text-muted mt-1 px-1">
                                    {mood.timeline.length > 0 && (
                                        <>
                                            <span>{mood.timeline[0].month}</span>
                                            <span>{mood.timeline[mood.timeline.length - 1].month}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Top tags</h3>
                                {data.topTags.length === 0 ? (
                                    <div className="text-xs text-text-muted">None yet</div>
                                ) : (
                                    <div className="space-y-1">
                                        {data.topTags.map(t => (
                                            <div key={t.tag} className="flex items-center justify-between text-sm">
                                                <span className="text-text-primary">{t.tag}</span>
                                                <span className="text-text-muted">{t.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Top moods</h3>
                                {data.topMoods.length === 0 ? (
                                    <div className="text-xs text-text-muted">None yet</div>
                                ) : (
                                    <div className="space-y-1">
                                        {data.topMoods.map(m => (
                                            <div key={m.mood} className="flex items-center justify-between text-sm">
                                                <span className="text-text-primary">{m.mood}</span>
                                                <span className="text-text-muted">{m.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="p-3 bg-bg-sidebar rounded border border-border-primary">
            <div className="flex items-center gap-1.5 text-text-muted text-xs mb-1">{icon}<span>{label}</span></div>
            <div className="text-xl font-semibold text-text-primary">{value}</div>
        </div>
    );
}
