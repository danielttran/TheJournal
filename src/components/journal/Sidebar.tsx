"use client";

import { ChevronLeft, ChevronRight, Search, Menu, Settings, Book, FileText } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';

interface SidebarProps {
    categoryId: string;
    userId: string;
    title: string;
    type: string;
}

export default function Sidebar({ categoryId, userId, title, type }: SidebarProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Journal Mode: Date Selection
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate ? (() => {
        const [y, m, d] = urlDate.split('-').map(Number);
        return new Date(y, m - 1, d);
    })() : new Date();
    const [currentMonth, setCurrentMonth] = useState(new Date());

    // Notebook Mode: Pages List
    const [pages, setPages] = useState<any[]>([]);
    // Journal Mode: Entries List (Tree)
    const [journalEntries, setJournalEntries] = useState<any[]>([]);

    useEffect(() => {
        if (type === 'Notebook') {
            fetchPages();
        } else if (type === 'Journal') {
            fetchJournalEntries();
        }
    }, [categoryId, type]);

    const fetchPages = async () => {
        try {
            const res = await fetch(`/api/entry?categoryId=${categoryId}`);
            const data = await res.json();
            if (Array.isArray(data)) setPages(data);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchJournalEntries = async () => {
        try {
            const res = await fetch(`/api/entry/dates?categoryId=${categoryId}`);
            const data = await res.json();
            if (Array.isArray(data)) setJournalEntries(data);
        } catch (e) {
            console.error(e);
        }
    };

    const onDateClick = (day: Date) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        router.push(`?date=${dateStr}`);
    };

    // Group Journal Entries by Year -> Month
    const groupedEntries = journalEntries.reduce((acc: any, entry: any) => {
        const date = new Date(entry.CreatedDate);
        if (isNaN(date.getTime())) return acc; // Skip invalid dates
        const year = format(date, 'yyyy');
        const month = format(date, 'MMMM');

        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];

        acc[year][month].push(entry);
        return acc;
    }, {});

    const onCreatePage = async () => {
        // Create a new untitled page
        const res = await fetch('/api/entry/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId, userId, title: 'Untitled Page' })
        });
        const newPage = await res.json();
        if (newPage.id) {
            setPages([...pages, newPage]);
            router.push(`?entry=${newPage.id}`); // Or however we nav to entries in notebook mode
        }
    };

    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

    // Generate Calendar Grid
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

    return (
        <div className="w-80 bg-gray-950 border-r border-gray-800 flex flex-col h-full flex-shrink-0">
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-gray-800">
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                        {type === 'Journal' ? <Book className="text-white w-4 h-4" /> : <FileText className="text-white w-4 h-4" />}
                    </div>
                    <span className="font-medium truncate max-w-[150px]">{title}</span>
                </div>
                <Link href="/dashboard" className="p-1 hover:bg-gray-800 rounded">
                    <ChevronLeft className="w-5 h-5 text-gray-400" />
                </Link>
            </div>

            {/* Content Swapper */}
            {type === 'Journal' ? (
                <>
                    {/* Calendar Widget */}
                    <div className="p-4 border-b border-gray-800">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold">{format(currentMonth, 'MMMM yyyy')}</h3>
                            <div className="flex space-x-1">
                                <button onClick={prevMonth} className="p-1 hover:bg-gray-800 rounded"><ChevronLeft className="w-4 h-4" /></button>
                                <button onClick={nextMonth} className="p-1 hover:bg-gray-800 rounded"><ChevronRight className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
                            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-sm">
                            {calendarDays.map((day, i) => {
                                const isSelected = isSameDay(day, selectedDate);
                                const isCurrentMonth = isSameMonth(day, currentMonth);
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onDateClick(day)}
                                        className={`
                                            p-1 rounded cursor-pointer flex items-center justify-center h-8 w-8 mx-auto
                                            ${!isCurrentMonth ? 'text-gray-700' : ''}
                                            ${isSelected ? 'bg-blue-600 text-white font-bold' : 'hover:bg-gray-800 text-gray-400'}
                                        `}
                                    >
                                        {format(day, 'd')}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Journal Tree View */}
                    <div className="flex-1 overflow-y-auto p-2">
                        {Object.keys(groupedEntries).sort((a, b) => a.localeCompare(b)).map(year => (
                            <details key={year} open className="group mb-2">
                                <summary className="flex items-center cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 px-2 mt-2 select-none hover:text-gray-300 outline-none">
                                    <span className="mr-1 group-open:rotate-90 transition-transform text-gray-600 inline-block w-3">▸</span>
                                    {year}
                                </summary>
                                {Object.keys(groupedEntries[year]).map(month => (
                                    <div key={month} className="pl-2">
                                        <details open className="group/month">
                                            <summary className="flex items-center cursor-pointer text-sm text-gray-400 hover:text-white py-1 px-2 rounded hover:bg-gray-800 select-none outline-none">
                                                <span className="mr-2 text-[10px] group-open/month:rotate-90 transition-transform inline-block w-3 text-gray-500">▸</span>
                                                {month}
                                            </summary>
                                            <div className="pl-6 space-y-0.5 mt-1 border-l border-gray-800 ml-3">
                                                {groupedEntries[year][month].sort((a: any, b: any) => new Date(a.CreatedDate).getTime() - new Date(b.CreatedDate).getTime()).map((entry: any) => {
                                                    const entryDate = new Date(entry.CreatedDate);
                                                    const isSelected = isSameDay(entryDate, selectedDate);
                                                    const displayTitle = entry.Title && entry.Title !== 'Untitled' ? ` - ${entry.Title}` : '';
                                                    return (
                                                        <div
                                                            key={entry.EntryID}
                                                            onClick={() => onDateClick(entryDate)}
                                                            className={`
                                                                px-2 py-1 rounded cursor-pointer text-sm truncate transition-colors
                                                                ${isSelected ? 'bg-purple-900/40 text-purple-200' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'}
                                                            `}
                                                            title={`${format(entryDate, 'PPP')}${displayTitle}`}
                                                        >
                                                            {format(entryDate, 'd')} ({format(entryDate, 'EEE')}){displayTitle}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </details>
                                    </div>
                                ))}
                            </details>
                        ))}

                        {journalEntries.length === 0 && (
                            <div className="px-4 py-8 text-center text-gray-600 text-sm">
                                Select a date to create your first entry
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <>
                    {/* Notebook Tree View */}
                    <div className="flex-1 overflow-y-auto p-2">
                        <div className="flex items-center justify-between px-2 mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pages</span>
                            <button onClick={onCreatePage} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white">
                                <Search className="w-3 h-3" /> {/* Replace with Plus icon if needed */}
                            </button>
                        </div>
                        <div className="space-y-1">
                            {pages.map(page => (
                                <div key={page.EntryID} className="px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer text-sm text-gray-300 truncate">
                                    {page.Title || 'Untitled'}
                                </div>
                            ))}
                            {pages.length === 0 && (
                                <div className="text-center py-4 text-gray-600 text-sm">No pages yet</div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Footer */}
            <div className="p-4 border-t border-gray-800">
                <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>{type} Mode</span>
                </div>
            </div>
        </div>
    );
}
