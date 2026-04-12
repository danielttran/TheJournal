export interface WritingPrompt {
    id: string;
    text: string;
    category: 'Gratitude' | 'Reflection' | 'Emotions' | 'Goals' | 'Fun';
}

export const WRITING_PROMPTS: WritingPrompt[] = [
    // ── Gratitude ──────────────────────────────────────────────────────────────
    { id: 'g1', category: 'Gratitude', text: 'What are three things you are grateful for today?' },
    { id: 'g2', category: 'Gratitude', text: 'Who made a positive difference in your life recently, and why?' },
    { id: 'g3', category: 'Gratitude', text: 'Describe a small moment from today that brought you joy.' },
    { id: 'g4', category: 'Gratitude', text: 'What is something about your body or health you appreciate?' },
    { id: 'g5', category: 'Gratitude', text: 'Name a skill or talent you have that you sometimes take for granted.' },
    { id: 'g6', category: 'Gratitude', text: 'What is one thing about your home or environment you are thankful for?' },
    { id: 'g7', category: 'Gratitude', text: 'Think of a challenge you overcame — what did it teach you?' },
    { id: 'g8', category: 'Gratitude', text: 'What is a book, song, or piece of art that enriched your life?' },

    // ── Reflection ─────────────────────────────────────────────────────────────
    { id: 'r1', category: 'Reflection', text: 'What was the most meaningful thing that happened this week?' },
    { id: 'r2', category: 'Reflection', text: 'If you could give your past self one piece of advice, what would it be?' },
    { id: 'r3', category: 'Reflection', text: 'What belief have you changed your mind about in the last year?' },
    { id: 'r4', category: 'Reflection', text: 'Describe a decision you made recently. Are you happy with it?' },
    { id: 'r5', category: 'Reflection', text: 'What habits are helping you most right now?' },
    { id: 'r6', category: 'Reflection', text: 'What is something you wish you had more time for?' },
    { id: 'r7', category: 'Reflection', text: 'How have you grown as a person in the past six months?' },
    { id: 'r8', category: 'Reflection', text: 'What would a perfect ordinary day look like for you?' },
    { id: 'r9', category: 'Reflection', text: 'What is one thing you keep putting off and why?' },

    // ── Emotions ───────────────────────────────────────────────────────────────
    { id: 'e1', category: 'Emotions', text: 'How are you feeling right now, and what might have caused that feeling?' },
    { id: 'e2', category: 'Emotions', text: 'Describe a moment recently when you felt proud of yourself.' },
    { id: 'e3', category: 'Emotions', text: 'What is something that has been worrying you? Write it out fully.' },
    { id: 'e4', category: 'Emotions', text: 'When did you last feel completely at peace? What were you doing?' },
    { id: 'e5', category: 'Emotions', text: 'What emotion do you find hardest to express? Why?' },
    { id: 'e6', category: 'Emotions', text: 'Describe a fear you have been carrying. What is the worst realistic outcome?' },
    { id: 'e7', category: 'Emotions', text: 'Write a letter to yourself about something you need to forgive yourself for.' },
    { id: 'e8', category: 'Emotions', text: 'What relationships in your life bring you the most energy right now?' },

    // ── Goals ──────────────────────────────────────────────────────────────────
    { id: 'go1', category: 'Goals', text: 'What is one goal you want to achieve in the next 30 days?' },
    { id: 'go2', category: 'Goals', text: 'Where do you want to be in five years? Describe it in detail.' },
    { id: 'go3', category: 'Goals', text: 'What is one small step you can take today toward a bigger goal?' },
    { id: 'go4', category: 'Goals', text: 'What does success mean to you — not to others, but to you specifically?' },
    { id: 'go5', category: 'Goals', text: 'Name one thing you want to learn or get better at this month.' },
    { id: 'go6', category: 'Goals', text: 'What would you do if you knew you could not fail?' },
    { id: 'go7', category: 'Goals', text: 'What habits would the best version of yourself have?' },
    { id: 'go8', category: 'Goals', text: 'What is holding you back from your biggest goal right now?' },

    // ── Fun ────────────────────────────────────────────────────────────────────
    { id: 'f1', category: 'Fun', text: 'If you could live anywhere in the world for one year, where would it be?' },
    { id: 'f2', category: 'Fun', text: 'Describe your ideal weekend from start to finish.' },
    { id: 'f3', category: 'Fun', text: 'If you could have dinner with any three people in history, who would you choose?' },
    { id: 'f4', category: 'Fun', text: 'What fictional world would you most want to visit?' },
    { id: 'f5', category: 'Fun', text: 'If you could master any skill instantly, what would it be and why?' },
    { id: 'f6', category: 'Fun', text: 'Describe your dream job — no limits on what is possible.' },
    { id: 'f7', category: 'Fun', text: 'What is the most adventurous thing on your bucket list?' },
    { id: 'f8', category: 'Fun', text: 'If you wrote a book, what would it be about?' },
];

export const PROMPT_CATEGORIES = ['Gratitude', 'Reflection', 'Emotions', 'Goals', 'Fun'] as const;
export type PromptCategory = typeof PROMPT_CATEGORIES[number];
