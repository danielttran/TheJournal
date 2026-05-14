export const DAILY_PROMPTS: string[] = [
    'What is one thing you are grateful for today?',
    'Describe a moment that made you smile this week.',
    'What is a challenge you faced recently, and what did it teach you?',
    'Write about a person who has shaped your life and why.',
    'What is something you have been avoiding, and why?',
    'If you could change one decision from your past, what would it be?',
    'What does "success" mean to you right now?',
    'List three small joys from today.',
    'Describe a place that feels like home.',
    'What is one goal you want to accomplish this month?',
    'Write about a recent dream — what stood out?',
    'What is something you learned in the last 30 days?',
    'How would you describe your current emotional weather?',
    'What is one habit you want to build, and what is the first step?',
    'Write a letter to your past self — one piece of advice.',
    'What boundaries do you need to set this week?',
    'Describe a meal you remember vividly. What made it special?',
    'What is energizing you right now? What is draining you?',
    'Write about a book, film, or song that moved you recently.',
    'What is something you are proud of, but rarely talk about?',
    'If today was your last day, what would you regret not saying?',
    'List five things you want more of in your life.',
    'What is one small kindness you can offer tomorrow?',
    'Describe a fear and what it might be trying to protect.',
    'What does rest look like to you?',
    'Write about a season of your life that taught you the most.',
    'What is one belief you have outgrown?',
    'Who do you want to thank — and for what?',
    'Describe a creative spark you want to follow up on.',
    'What is your relationship to silence?',
    'List three things you are looking forward to.',
    'Write about a recent disappointment and what it revealed.',
    'What do you wish more people understood about you?',
    'Describe your ideal Sunday morning in detail.',
    'What is one question you are sitting with right now?',
];

function dayOfYearUTC(d: Date): number {
    // Days since Jan 1 of `d`'s UTC year — stable across DST shifts.
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((d.getTime() - start) / 86400000);
}

/**
 * Return the prompt for `date`. Deterministic per (year, day-of-year).
 * Using year * 366 + dayOfYear so the cycle advances even across year
 * boundaries — N days after `date` always yields a stable result.
 */
export function promptOfTheDay(date: Date): string {
    let d = date;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) d = new Date();
    const idx = (d.getUTCFullYear() * 366 + dayOfYearUTC(d)) % DAILY_PROMPTS.length;
    return DAILY_PROMPTS[idx];
}
