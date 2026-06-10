/**
 * Auto-correction of common English misspellings (J8 "Automatically corrects
 * common English misspellings"). Pure: the editor calls correctWord() on the
 * word behind the caret at a word boundary (space / Enter), mirroring the
 * snippet-expansion hook.
 */

export const AUTOCORRECT_KEY = 'editorAutocorrect';
export const AUTOCORRECT_EVENT = 'autocorrect-changed';

/** Lowercase misspelling → correction. */
export const AUTOCORRECT_RULES: Record<string, string> = {
    'abbout': 'about', 'abscence': 'absence', 'accidentaly': 'accidentally',
    'accomodate': 'accommodate', 'acheive': 'achieve', 'acommodate': 'accommodate',
    'acording': 'according', 'agian': 'again', 'agressive': 'aggressive',
    'alot': 'a lot', 'alright': 'all right', 'amung': 'among',
    'anual': 'annual', 'apparant': 'apparent', 'appearence': 'appearance',
    'arguement': 'argument', 'assesment': 'assessment', 'aswell': 'as well',
    'basicly': 'basically', 'becuase': 'because', 'begining': 'beginning',
    'beleive': 'believe', 'belive': 'believe', 'benifit': 'benefit',
    'buisness': 'business', 'calender': 'calendar', 'catagory': 'category',
    'cemetary': 'cemetery', 'changable': 'changeable', 'cheif': 'chief',
    'collegue': 'colleague', 'comming': 'coming', 'commitee': 'committee',
    'completly': 'completely', 'concious': 'conscious', 'definately': 'definitely',
    'definatly': 'definitely', 'dissapear': 'disappear', 'dissapoint': 'disappoint',
    'doesnt': "doesn't", 'dont': "don't", 'embarass': 'embarrass',
    'enviroment': 'environment', 'excercise': 'exercise', 'existance': 'existence',
    'experiance': 'experience', 'familar': 'familiar', 'finaly': 'finally',
    'foriegn': 'foreign', 'freind': 'friend', 'futher': 'further',
    'goverment': 'government', 'gaurd': 'guard', 'happend': 'happened',
    'harrass': 'harass', 'hight': 'height', 'humourous': 'humorous',
    'immediatly': 'immediately', 'independant': 'independent', 'isnt': "isn't",
    'knowlege': 'knowledge', 'liason': 'liaison', 'libary': 'library',
    'lisence': 'license', 'maintainance': 'maintenance', 'maintenence': 'maintenance',
    'medecine': 'medicine', 'momento': 'memento', 'neccessary': 'necessary',
    'necesary': 'necessary', 'noticable': 'noticeable', 'occassion': 'occasion',
    'occured': 'occurred', 'occurence': 'occurrence', 'oppurtunity': 'opportunity',
    'paralel': 'parallel', 'peice': 'piece', 'persistant': 'persistent',
    'posession': 'possession', 'prefered': 'preferred', 'probaly': 'probably',
    'publically': 'publicly', 'realy': 'really', 'recieve': 'receive',
    'recomend': 'recommend', 'refered': 'referred', 'relevent': 'relevant',
    'religous': 'religious', 'remeber': 'remember', 'reccomend': 'recommend',
    'seperate': 'separate', 'shedule': 'schedule', 'similiar': 'similar',
    'sincerly': 'sincerely', 'speach': 'speech', 'succesful': 'successful',
    'successfull': 'successful', 'sucess': 'success', 'suprise': 'surprise',
    'teh': 'the', 'tommorow': 'tomorrow', 'tommorrow': 'tomorrow',
    'tounge': 'tongue', 'truely': 'truly', 'unfortunatly': 'unfortunately',
    'untill': 'until', 'wierd': 'weird', 'wont': "won't",
    'wich': 'which', 'whith': 'with', 'youre': "you're",
};

/**
 * Correct a single word if it's a known misspelling, preserving leading-cap
 * and all-caps casing. Returns null when no correction applies.
 */
export function correctWord(word: string): string | null {
    if (!word) return null;
    const lower = word.toLowerCase();
    const fix = AUTOCORRECT_RULES[lower];
    if (!fix) return null;
    if (word === lower) return fix;
    if (word === word.toUpperCase() && word.length > 1) return fix.toUpperCase();
    if (word[0] === word[0].toUpperCase()) return fix.charAt(0).toUpperCase() + fix.slice(1);
    return fix;
}

/** Extract the word ending exactly at the end of `textBefore` (caret). */
export function wordBehindCaret(textBefore: string): string {
    const m = /([A-Za-z']+)$/.exec(textBefore);
    return m ? m[1] : '';
}

export function parseAutocorrectSetting(raw: string | null): boolean {
    return raw !== '0';
}

export function isAutocorrectEnabled(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return parseAutocorrectSetting(localStorage.getItem(AUTOCORRECT_KEY));
}

export function setAutocorrectEnabled(enabled: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUTOCORRECT_KEY, enabled ? '1' : '0');
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTOCORRECT_EVENT));
    }
}
