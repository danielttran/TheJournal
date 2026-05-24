(function () {
  // Sentence Studio — AI-assisted sentence diagrammer for TheJournal.
  // Vanilla JS + SVG port of the "Sentence Studio" design handoff (a React/M3
  // prototype). Plugins run via new Function() — no imports, no JSX, no build —
  // so the whole UI is hand-built DOM/SVG. Material 3 styling is injected once
  // and namespaced under .tj-ss-root so it can't leak into TheJournal's editor.
  //
  // Node storage: attrs.state = { sentence, parse, style, extras, wordOffsets,
  // colorCode, showClauseLabels, zoom, isDefault }; attrs.previewSvg = a static,
  // self-contained SVG (concrete colors, no external stylesheet) for inline
  // display in the entry and for export/print.
  const API = window.TheJournalAPI;
  if (!API || typeof API.registerTiptapExtension !== 'function') return;

  const NS = 'http://www.w3.org/2000/svg';
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  // ── tiny hyperscript helpers ────────────────────────────────────────────────
  function setAttrs(el, attrs) {
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') { for (const s of Object.keys(v)) el.style.setProperty(cssVarKey(s), v[s]); }
      else if (k === 'class' || k === 'className') el.setAttribute('class', v);
      else if (k === 'dataset') { for (const d of Object.keys(v)) el.dataset[d] = v[d]; }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, String(v));
    }
  }
  function cssVarKey(s) { return s.indexOf('--') === 0 ? s : s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }
  function append(el, kids) {
    for (const kid of kids) {
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) append(el, kid);
      else el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
  }
  function h(tag, attrs, ...kids) { const el = document.createElement(tag); setAttrs(el, attrs); append(el, kids); return el; }
  function s(tag, attrs, ...kids) { const el = document.createElementNS(NS, tag); setAttrs(el, attrs); append(el, kids); return el; }

  // ── icons (ported from icons.jsx — Material Icons, Apache 2.0) ───────────────
  const ICON_PATHS = {
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    auto_awesome: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z',
    palette: 'M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5 0-.16-.08-.28-.14-.35-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 0 1 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4A1.5 1.5 0 1 1 9.5 6 1.5 1.5 0 0 1 9.5 9zm5 0A1.5 1.5 0 1 1 14.5 6a1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    label: 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z',
    fit_screen: 'M17 4h3c1.1 0 2 .9 2 2v3h-2V6h-3V4zM4 9V6h3V4H4c-1.1 0-2 .9-2 2v3h2zm16 6v3h-3v2h3c1.1 0 2-.9 2-2v-3h-2zM7 18H4v-3H2v3c0 1.1.9 2 2 2h3v-2z',
    remove: 'M19 13H5v-2h14v2z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    touch_app: 'M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z',
    category: 'M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z',
    swap_horiz: 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
    auto_fix_high: 'M7.5 5.6L10 7L8.6 4.5L10 2L7.5 3.4L5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5L22 2zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41l-2.33-2.35zm-1.03 5.49l-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z',
    play_arrow: 'M8 5v14l11-7z',
    open_in_new: 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    account_tree: 'M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z',
    sync_alt: 'M18 12l4-4-4-4v3H3v2h15v3zM6 12l-4 4 4 4v-3h15v-2H6v-3z',
    horizontal_rule: 'M4 11h16v2H4z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  };
  function icon(name, size, color) {
    const sz = size || 20;
    const path = ICON_PATHS[name];
    const svg = s('svg', { width: sz, height: sz, viewBox: '0 0 24 24', fill: color || 'currentColor', style: { display: 'inline-block', 'vertical-align': 'middle', 'flex-shrink': '0' }, 'aria-hidden': 'true' });
    if (path) svg.appendChild(s('path', { d: path }));
    return svg;
  }

  // edit-palette tool icons (custom inline SVG, ported from edit-palette.jsx)
  function toolIcon(name) {
    const svg = s('svg', { viewBox: '0 0 24 24', width: 22, height: 22 });
    const L = (x1, y1, x2, y2, extra) => s('line', Object.assign({ x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 1.6 }, extra));
    const map = {
      pointer: () => [s('path', { d: 'M5 3l14 7-6 2-2 6-6-15z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round' })],
      word: () => [s('rect', { x: 3, y: 9, width: 18, height: 8, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }), s('text', { x: 12, y: 15, 'text-anchor': 'middle', 'font-size': 6, fill: 'currentColor', 'font-weight': 600 }, 'Aa')],
      baseline: () => [L(3, 12, 21, 12, { 'stroke-width': 2 }), L(11, 8, 11, 16, { 'stroke-width': 2 })],
      modifier: () => [L(4, 8, 20, 8), L(11, 8, 17, 20)],
      vertical: () => [L(4, 12, 20, 12), L(12, 6, 12, 18)],
      pedestal: () => [L(4, 16, 20, 16), L(12, 4, 12, 16), L(9, 4, 15, 4)],
      fork: () => [L(4, 12, 10, 12), L(10, 12, 14, 8), L(10, 12, 14, 16), L(14, 8, 20, 8), L(14, 16, 20, 16)],
      prep: () => [L(4, 8, 14, 8), L(10, 8, 16, 18), L(14, 18, 22, 18)],
      dashed: () => [L(4, 6, 20, 20, { 'stroke-dasharray': '3 3' })],
      trash: () => [s('path', { d: 'M9 3v1H4v2h16V4h-5V3H9zm-3 4l1 13c.1 1.1 1 2 2.1 2h5.8c1.1 0 2-.9 2.1-2L18 7H6z', fill: 'currentColor' })],
      add: () => [s('path', { d: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z', fill: 'currentColor' })],
      edit: () => [s('path', { d: ICON_PATHS.edit, fill: 'currentColor' })],
      arc: () => [s('path', { d: 'M4 18 Q 12 4, 20 18', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }), s('polygon', { points: '17,15 20,18 22,14', fill: 'currentColor' })],
    };
    append(svg, (map[name] || map.pointer)());
    return svg;
  }

  // ── data (ported verbatim from data.js) ──────────────────────────────────────
  const POS_DEFS = [
    { code: 'NOUN', label: 'Noun', swatch: 'var(--pos-noun)', desc: 'Person, place, thing, or idea' },
    { code: 'PRON', label: 'Pronoun', swatch: 'var(--pos-pron)', desc: 'Stands in for a noun' },
    { code: 'VERB', label: 'Verb', swatch: 'var(--pos-verb)', desc: 'Action or state of being' },
    { code: 'AUX', label: 'Auxiliary', swatch: 'var(--pos-aux)', desc: 'Helping verb (will, be, have…)' },
    { code: 'ADJ', label: 'Adjective', swatch: 'var(--pos-adj)', desc: 'Describes a noun' },
    { code: 'ADV', label: 'Adverb', swatch: 'var(--pos-adv)', desc: 'Describes a verb, adj, or adverb' },
    { code: 'DET', label: 'Determiner', swatch: 'var(--pos-det)', desc: 'Article or quantifier (the, a, his…)' },
    { code: 'PREP', label: 'Preposition', swatch: 'var(--pos-prep)', desc: 'Relates a noun to other words' },
    { code: 'CONJ', label: 'Conjunction', swatch: 'var(--pos-conj)', desc: 'Connects clauses or words' },
  ];
  const POS_LOOKUP = Object.fromEntries(POS_DEFS.map((p) => [p.code, p]));
  // Concrete pastel hex (tokens.css list palette) — for self-contained export SVG.
  const POS_HEX = { NOUN: '#CFE2F3', VERB: '#FDE8D4', ADJ: '#D5E8D4', ADV: '#E1D5E7', PRON: '#D1ECF1', PREP: '#FFF2CC', CONJ: '#F8D7DA', DET: '#F5ECD7', AUX: '#D4EDDA' };

  const TOKENS = [
    { i: 0, word: 'for', pos: 'CONJ', role: 'subord-conj', clause: 'c0' },
    { i: 1, word: 'God', pos: 'NOUN', role: 'subject', clause: 'c1' },
    { i: 2, word: 'so', pos: 'ADV', role: 'adverb-modifier', parent: 3, clause: 'c1' },
    { i: 3, word: 'loved', pos: 'VERB', role: 'main-verb', clause: 'c1' },
    { i: 4, word: 'the', pos: 'DET', role: 'determiner', parent: 5, clause: 'c1' },
    { i: 5, word: 'world', pos: 'NOUN', role: 'direct-object', parent: 3, clause: 'c1' },
    { i: 6, word: 'that', pos: 'CONJ', role: 'subord-conj', clause: 'c2' },
    { i: 7, word: 'He', pos: 'PRON', role: 'subject', clause: 'c2' },
    { i: 8, word: 'gave', pos: 'VERB', role: 'main-verb', clause: 'c2' },
    { i: 9, word: 'His', pos: 'DET', role: 'possessive', parent: 11, clause: 'c2' },
    { i: 10, word: 'only', pos: 'ADJ', role: 'adjective-mod', parent: 11, clause: 'c2' },
    { i: 11, word: 'Son', pos: 'NOUN', role: 'direct-object', parent: 8, clause: 'c2' },
    { i: 12, word: 'so', pos: 'CONJ', role: 'subord-conj', clause: 'c3' },
    { i: 13, word: 'that', pos: 'CONJ', role: 'subord-conj', clause: 'c3' },
    { i: 14, word: 'whoever', pos: 'PRON', role: 'subject', clause: 'c3' },
    { i: 15, word: 'believes', pos: 'VERB', role: 'rel-verb', clause: 'c3r' },
    { i: 16, word: 'in', pos: 'PREP', role: 'preposition', parent: 15, clause: 'c3r' },
    { i: 17, word: 'Him', pos: 'PRON', role: 'prep-object', parent: 16, clause: 'c3r' },
    { i: 18, word: 'will', pos: 'AUX', role: 'auxiliary', parent: 20, clause: 'c3' },
    { i: 19, word: 'not', pos: 'ADV', role: 'adverb-modifier', parent: 20, clause: 'c3' },
    { i: 20, word: 'perish', pos: 'VERB', role: 'main-verb', clause: 'c3' },
    { i: 21, word: 'but', pos: 'CONJ', role: 'coord-conj', clause: 'c3' },
    { i: 22, word: 'have', pos: 'VERB', role: 'main-verb', clause: 'c3' },
    { i: 23, word: 'eternal', pos: 'ADJ', role: 'adjective-mod', parent: 24, clause: 'c3' },
    { i: 24, word: 'life', pos: 'NOUN', role: 'direct-object', parent: 22, clause: 'c3' },
  ];
  const JOHN_CLAUSES = [
    { id: 'c1', label: 'Main clause', depth: 0 },
    { id: 'c2', label: 'Result clause', depth: 1 },
    { id: 'c3', label: 'Purpose clause', depth: 2 },
    { id: 'c3r', label: 'Relative clause', depth: 3 },
  ];
  const ROLE_LABELS = {
    'subject': 'Subject', 'main-verb': 'Verb', 'direct-object': 'Direct Object',
    'adverb-modifier': 'Adverb modifier', 'adjective-mod': 'Adjective modifier',
    'determiner': 'Determiner', 'possessive': 'Possessive', 'preposition': 'Preposition',
    'prep-object': 'Object of preposition', 'subord-conj': 'Subordinating conj.',
    'coord-conj': 'Coordinating conj.', 'auxiliary': 'Auxiliary verb', 'rel-verb': 'Verb (relative clause)',
  };
  const DEFAULT_SENTENCE = 'for God so loved the world that He gave His only Son so that whoever believes in Him will not perish but have eternal life';

  function defaultParse() {
    return {
      tokens: TOKENS.map((t) => ({ i: t.i, word: t.word, pos: t.pos, role: t.role, parent: t.parent, clause: t.clause })),
      clausesMeta: JOHN_CLAUSES,
      clauses: [
        { id: 'c1', type: 'main', label: 'Main clause', subject: 1, verb: 3, object: 5, parent: null, conj: 0, tokens: [1, 2, 3, 4, 5] },
        { id: 'c2', type: 'subord', label: 'Result clause', subject: 7, verb: 8, object: 11, parent: 'c1', conj: 6, tokens: [7, 8, 9, 10, 11] },
        { id: 'c3', type: 'subord', label: 'Purpose clause', subject: 14, verb: 20, object: null, parent: 'c2', conj: 12, tokens: [14, 18, 19, 20, 21, 22, 23, 24] },
        { id: 'c3r', type: 'relative', label: 'Relative clause', subject: 14, verb: 15, object: null, parent: 'c3', conj: null, tokens: [15, 16, 17] },
      ],
      modifiers: [
        { head: 3, mod: 2, kind: 'adv' }, { head: 5, mod: 4, kind: 'det' },
        { head: 11, mod: 9, kind: 'poss' }, { head: 11, mod: 10, kind: 'adj' },
        { head: 20, mod: 18, kind: 'aux' }, { head: 20, mod: 19, kind: 'adv' },
        { head: 22, mod: 18, kind: 'aux' }, { head: 24, mod: 23, kind: 'adj' },
      ],
      preps: [{ prep: 16, obj: 17, attaches_to: 15 }],
      compounds: [{ head: 20, members: [20, 22], conj: 21, kind: 'verb' }],
      deps: [],
    };
  }

  // ── heuristic parser (replaces the prototype's AI call) ──────────────────────
  // Self-hosted TheJournal is offline with no LLM endpoint, so we POS-tag and
  // derive structure with rules. A host can override by defining
  // window.TheJournalAPI.parseSentence(text) -> Promise<parse>.
  const SET = (str) => new Set(str.split(' '));
  const AUX = SET('am is are was were be been being have has had do does did will would shall should can could may might must');
  const DET = SET('the a an this that these those my your his her its our their some any no every each all both most another either neither');
  const PREP = SET('in on at by for with to from of about over under into onto upon through between among against during before after above below near off out up down across behind beside beyond within without around along toward towards per via amid');
  const PRON = SET('i you he she it we they me him us them who whom whose which whatever whoever myself yourself himself herself itself ourselves themselves someone anyone everyone something anything everything nobody somebody');
  const CONJ = SET('and or but nor yet so because although though while since unless until if whether as when where than that');
  const ADV = SET('not very so too well now then here there always never often sometimes also just only really almost soon again ever quite rather even still today tomorrow yesterday');
  // Common adjectives + verbs that no suffix rule catches (esp. present-tense -s
  // and irregular verbs). A real LLM hook can replace this; see parseSentence.
  const ADJ_LEX = SET('quick brown lazy big small good bad happy sad old new young red blue green white black great little long short high low hot cold fast slow hard easy early late full empty same different other own first last next many much more most few less least eternal able real true false free whole main able sure clear dark light heavy soft loud quiet strong weak rich poor');
  const VERB_LEX = SET('run runs ran go goes went give gives gave make makes made see sees saw take takes took come comes came know knows knew get gets got find finds found think thinks thought tell tells told become becomes became leave leaves left feel feels felt bring brings brought begin begins began keep keeps kept hold holds held write writes wrote stand stands stood hear hears heard mean means meant set sets meet meets met pay pays paid sit sits sat speak speaks spoke read reads lead leads led grow grows grew lose loses lost fall falls fell send sends sent build builds built understand draw draws drew break breaks broke spend spends spent cut cuts rise rises rose drive drives drove buy buys bought wear wears wore choose chooses chose catch catches caught teach teaches taught jump jumps jumped walk walks walked talk talks talked play plays played want wants wanted need needs needed like likes liked love loves loved live lives lived work works worked call calls called try tries tried ask asks asked turn turns turned help helps helped show shows showed move moves moved believe believes believed sing sings sang dance dances danced sell sells sold perish perishes perished stop stops stopped finish finishes finished stay stays stayed gave loved');
  // High-precision adjective suffixes only — broad ones (al/ic/ent/ary) match too
  // many nouns (table, music, student), which breaks subject/object detection.
  const ADJ_SUFFIX = /(ous|ful|ive|ish|less|able|ible)$/;
  const POSS = SET('my your his her its our their whose');

  function tagWord(word, index) {
    const lw = word.toLowerCase();
    if (AUX.has(lw)) return 'AUX';
    if (DET.has(lw)) return 'DET';
    if (PREP.has(lw)) return 'PREP';
    if (PRON.has(lw)) return 'PRON';
    if (CONJ.has(lw)) return 'CONJ';
    if (ADV.has(lw)) return 'ADV';
    if (ADJ_LEX.has(lw)) return 'ADJ';
    if (VERB_LEX.has(lw)) return 'VERB';
    if (/ly$/.test(lw) && lw.length > 3) return 'ADV';
    if (ADJ_SUFFIX.test(lw) && lw.length > 5) return 'ADJ';
    if (/(ing|ed|ize|ise|ate)$/.test(lw) && lw.length > 4) return 'VERB';
    if (index > 0 && /^[A-Z]/.test(word)) return 'NOUN'; // proper noun
    return 'NOUN';
  }

  // Every clause needs a verb; if tagging produced none, retag the first noun
  // after the subject (but stop at a preposition — that starts a phrase, not a
  // predicate, so a verbless fragment stays verbless).
  function ensureVerb(tokens) {
    if (tokens.some((t) => t.pos === 'VERB' || t.pos === 'AUX')) return;
    let subjEnd = -1;
    for (let i = 0; i < tokens.length; i++) { if (tokens[i].pos === 'NOUN' || tokens[i].pos === 'PRON') { subjEnd = i; break; } }
    for (let i = subjEnd + 1; i < tokens.length; i++) { if (tokens[i].pos === 'PREP') break; if (tokens[i].pos === 'NOUN') { tokens[i].pos = 'VERB'; break; } }
  }
  function wordList(text) { return String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []; }

  function analyze(tokens) {
    const n = tokens.length;
    const is = (i, p) => i >= 0 && i < n && tokens[i].pos === p;
    const isNounish = (i) => is(i, 'NOUN') || is(i, 'PRON');
    let verbIdx = tokens.findIndex((t) => t.pos === 'VERB');
    if (verbIdx < 0) verbIdx = tokens.findIndex((t) => t.pos === 'AUX');
    const modifiers = [], preps = [], compounds = [];
    const roleOf = {}, parentOf = {};

    // subject: nearest noun/pron before the verb
    let subject = null;
    if (verbIdx > 0) for (let i = verbIdx - 1; i >= 0; i--) { if (isNounish(i)) { subject = i; break; } }
    // object: first noun/pron after the verb, but stop at a preposition or
    // conjunction — what follows is a prep phrase / new clause, not the object.
    let object = null;
    if (verbIdx >= 0) for (let i = verbIdx + 1; i < n; i++) { if (is(i, 'PREP') || is(i, 'CONJ')) break; if (isNounish(i)) { object = i; break; } }

    const nextNoun = (from) => { for (let i = from; i < n; i++) if (isNounish(i)) return i; return null; };
    const prevHead = (from) => { for (let i = from; i >= 0; i--) if (isNounish(i) || is(i, 'VERB')) return i; return verbIdx; };

    tokens.forEach((t, i) => {
      const lw = t.word.toLowerCase();
      if (t.pos === 'DET') { const head = nextNoun(i + 1); if (head != null) { modifiers.push({ head, mod: i, kind: POSS.has(lw) ? 'poss' : 'det' }); parentOf[i] = head; roleOf[i] = POSS.has(lw) ? 'possessive' : 'determiner'; } }
      else if (t.pos === 'ADJ') { const head = nextNoun(i + 1); if (head != null) { modifiers.push({ head, mod: i, kind: 'adj' }); parentOf[i] = head; roleOf[i] = 'adjective-mod'; } }
      else if (t.pos === 'ADV') { if (verbIdx >= 0) { modifiers.push({ head: verbIdx, mod: i, kind: 'adv' }); parentOf[i] = verbIdx; roleOf[i] = 'adverb-modifier'; } }
      else if (t.pos === 'AUX' && i !== verbIdx) { if (verbIdx >= 0) { modifiers.push({ head: verbIdx, mod: i, kind: 'aux' }); parentOf[i] = verbIdx; roleOf[i] = 'auxiliary'; } }
      else if (t.pos === 'PREP') { const obj = nextNoun(i + 1); const attach = prevHead(i - 1); if (obj != null) { preps.push({ prep: i, obj, attaches_to: attach == null ? verbIdx : attach }); parentOf[i] = attach == null ? verbIdx : attach; roleOf[i] = 'preposition'; parentOf[obj] = i; roleOf[obj] = 'prep-object'; } }
    });

    // compound verbs: VERB CONJ VERB
    for (let i = 0; i < n - 2; i++) {
      if (is(i, 'VERB') && is(i + 1, 'CONJ') && is(i + 2, 'VERB')) { compounds.push({ head: i, members: [i, i + 2], conj: i + 1, kind: 'verb' }); }
    }

    if (subject != null) roleOf[subject] = 'subject';
    if (verbIdx >= 0) roleOf[verbIdx] = 'main-verb';
    if (object != null) { roleOf[object] = 'direct-object'; parentOf[object] = verbIdx; }
    // leading subordinator/coordinator
    let conj = null;
    if (is(0, 'CONJ')) { conj = 0; roleOf[0] = 'subord-conj'; }

    // Leave unstructured words roleless ('') — the inspector shows '—' rather
    // than a bare POS like "noun" in the Function field.
    tokens.forEach((t, i) => { t.role = roleOf[i] || (t.pos === 'CONJ' ? 'coord-conj' : ''); t.parent = parentOf[i]; t.clause = 'c1'; });

    const clauses = [{ id: 'c1', type: 'main', label: 'Main clause', subject, verb: verbIdx < 0 ? null : verbIdx, object, parent: null, conj, tokens: tokens.map((_, i) => i) }];
    return { clauses, modifiers, preps, compounds };
  }

  function deriveDeps(clauses, modifiers, preps, compounds) {
    const deps = [];
    clauses.forEach((c) => {
      if (c.subject != null && c.verb != null) deps.push({ head: c.verb, dep: c.subject, rel: 'nsubj' });
      if (c.object != null && c.verb != null) deps.push({ head: c.verb, dep: c.object, rel: 'obj' });
      if (c.conj != null && c.verb != null) deps.push({ head: c.verb, dep: c.conj, rel: 'mark' });
      if (c.parent != null) { const par = clauses.find((p) => p.id === c.parent); if (par && par.verb != null && c.verb != null) deps.push({ head: par.verb, dep: c.verb, rel: 'advcl' }); }
    });
    modifiers.forEach((m) => { const rel = m.kind === 'aux' ? 'aux' : m.kind === 'adv' ? 'advmod' : m.kind === 'det' ? 'det' : m.kind === 'poss' ? 'nmod:poss' : 'amod'; deps.push({ head: m.head, dep: m.mod, rel }); });
    preps.forEach((p) => { deps.push({ head: p.attaches_to, dep: p.obj, rel: 'obl' }); deps.push({ head: p.obj, dep: p.prep, rel: 'case' }); });
    compounds.forEach((c) => { (c.members || []).slice(1).forEach((m) => deps.push({ head: c.head, dep: m, rel: 'conj' })); if (c.conj != null && c.members && c.members.length > 1) deps.push({ head: c.members[1], dep: c.conj, rel: 'cc' }); });
    return deps;
  }

  function heuristicParse(sentence) {
    const text = String(sentence || '').trim().replace(/[.!?;:,]+$/, '');
    const words = wordList(text);
    if (!words.length) return null;
    const tokens = words.map((w, i) => ({ i, word: w, pos: tagWord(w, i) }));
    ensureVerb(tokens);
    const { clauses, modifiers, preps, compounds } = analyze(tokens);
    const deps = deriveDeps(clauses, modifiers, preps, compounds);
    const clausesMeta = [{ id: 'c1', label: 'Main clause', depth: 0 }];
    return { tokens, clauses, clausesMeta, modifiers, preps, compounds, deps };
  }

  async function parseSentence(sentence) {
    if (typeof API.parseSentence === 'function') return API.parseSentence(sentence);
    // Local heuristic resolves synchronously; wrap so the caller can await.
    return heuristicParse(sentence);
  }

  // ── geometry / diagram helpers ───────────────────────────────────────────────
  function wordWidth(word) { return Math.max(40, (word || '').length * 11 + 14); }

  // ── diagram renderers ────────────────────────────────────────────────────────
  // ctx: { tokens, parse, isDefault, style, selected, selectedExtra, colorCode,
  //   showClauseLabels, wordOffsets, extras, activeTool, draggable, arcSrc,
  //   colors, interactive, on:{select,drag,canvasClick,selectExtra,deleteExtra,depWord} }
  function wordTile(ctx, token, cx, cy, opts) {
    opts = opts || {};
    const C = ctx.colors;
    const w = opts.width || wordWidth(token.word);
    const hgt = 26;
    const off = ctx.wordOffsets[token.i] || {};
    const dx = off.dx || 0, dy = off.dy || 0;
    const x = cx - w / 2 + dx, y = cy - hgt + 4 + dy;
    const tx = cx + dx, ty = cy + dy;
    const selected = ctx.selected === token.i || (opts.selectedOverride);
    const fill = ctx.colorCode ? (ctx.colors.pos(token.pos)) : 'transparent';
    const g = s('g', { class: 'tj-ss-word-tile' + (selected ? ' sel' : '') + (opts.draggable ? ' drag' : ''), transform: opts.rotation ? `rotate(${opts.rotation} ${tx} ${ty})` : null });
    g.appendChild(s('rect', { x, y, width: w, height: hgt, rx: 5, ry: 5, fill, stroke: selected ? C.primary : 'transparent', 'stroke-width': selected ? 2 : 0 }));
    g.appendChild(s('text', { x: tx, y: ty, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 18, 'font-weight': 500, fill: C.ink }, token.word));
    if (ctx.interactive) attachWordHandlers(ctx, g, token, opts);
    return g;
  }
  function attachWordHandlers(ctx, g, token, opts) {
    g.style.cursor = opts.draggable ? 'grab' : 'pointer';
    // pointerdown only — the drag lifecycle (move/up) lives on the overlay root
    // so re-rendering the diagram doesn't destroy the captured element mid-drag.
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (opts.depWord) { ctx.on.depWord(token.i); return; }
      if (!opts.draggable) { ctx.on.select(token.i); return; }
      ctx.on.dragStart(token.i, e);
    });
  }
  function svgPoint(e, svg) {
    if (!svg || !svg.createSVGPoint) return { x: e.clientX || 0, y: e.clientY || 0 };
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM(); if (!ctm) return { x: 0, y: 0 };
    const m = pt.matrixTransform(ctm.inverse());
    return { x: m.x, y: m.y };
  }
  function line(ctx, x1, y1, x2, y2, opts) {
    opts = opts || {}; const C = ctx.colors;
    return s('line', { x1, y1, x2, y2, stroke: opts.stroke || C.ink, 'stroke-width': opts.w || 2, 'stroke-dasharray': opts.dash || null, fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  }
  function slantMod(ctx, token, baseX, baseY, opts) {
    opts = opts || {}; const length = opts.length || 70, angle = opts.angle || 55, side = opts.side || 'right';
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad) * length * (side === 'right' ? 1 : -1), dy = Math.sin(rad) * length;
    const endX = baseX + dx, endY = baseY + dy;
    const t = 0.45, wx = baseX + dx * t, wy = baseY + dy * t;
    const g = s('g', {});
    g.appendChild(line(ctx, baseX, baseY, endX, endY, { w: 1.5 }));
    g.appendChild(wordTile(ctx, token, wx, wy - 4, { rotation: side === 'right' ? angle : -angle, draggable: ctx.draggable }));
    return g;
  }
  function dashedConnector(ctx, x1, y1, x2, y2, label, labelOffset) {
    const C = ctx.colors; const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const g = s('g', {});
    g.appendChild(line(ctx, x1, y1, x2, y2, { dash: '5 4', w: 1.5 }));
    if (label) g.appendChild(s('text', { x: mx + (labelOffset || 0), y: my - 6, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 14, 'font-style': 'italic', fill: C.ink, transform: `rotate(${ang} ${mx + (labelOffset || 0)} ${my - 6})` }, label));
    return g;
  }

  function extrasLayer(ctx) {
    const C = ctx.colors;
    const g = s('g', { class: 'tj-ss-extras' });
    (ctx.extras || []).forEach((ex) => {
      const sel = ctx.selectedExtra === ex.id;
      const st = (base) => sel ? C.primary : base;
      let node = null;
      if (ex.type === 'baseline') { node = s('g', {}, line(ctx, ex.x1, ex.y, ex.x2, ex.y, { stroke: st(C.ink), w: sel ? 3 : 2 })); }
      else if (ex.type === 'word') {
        const w = wordWidth(ex.text || 'word');
        node = s('g', { class: 'tj-ss-word-tile' }, s('rect', { x: ex.x - w / 2, y: ex.y - 22, width: w, height: 26, rx: 5, ry: 5, fill: ctx.colorCode ? C.pos(ex.pos) : 'transparent', stroke: sel ? C.primary : 'transparent', 'stroke-width': sel ? 2 : 0 }), s('text', { x: ex.x, y: ex.y - 4, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 18, 'font-weight': 500, fill: C.ink }, ex.text || 'word'));
      } else if (ex.type === 'modifier') {
        const rad = (ex.angle || 60) * Math.PI / 180; const dx = Math.cos(rad) * (ex.length || 60) * (ex.side === 'left' ? -1 : 1); const dy = Math.sin(rad) * (ex.length || 60);
        const tx = ex.x + dx * 0.45, ty = ex.y + dy * 0.45 - 4; const rot = ex.side === 'left' ? -(ex.angle || 60) : (ex.angle || 60);
        node = s('g', {}, line(ctx, ex.x, ex.y, ex.x + dx, ex.y + dy, { stroke: st(C.ink), w: sel ? 2.5 : 1.5 }), s('text', { x: tx, y: ty, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 18, fill: C.ink, transform: `rotate(${rot} ${tx} ${ty})` }, ex.text || 'mod'));
      } else if (ex.type === 'vertical') { node = line(ctx, ex.x, ex.y1, ex.x, ex.y2, { stroke: st(C.ink), w: sel ? 3 : 2 }); }
      else if (ex.type === 'pedestal') { node = s('g', {}, line(ctx, ex.x - 8, ex.y - 24, ex.x + 8, ex.y - 24, { stroke: st(C.ink), w: sel ? 2.5 : 1.5 }), line(ctx, ex.x, ex.y - 24, ex.x, ex.y, { stroke: st(C.ink), w: sel ? 2.5 : 1.5 })); }
      else if (ex.type === 'fork') { node = s('g', {}, line(ctx, ex.x, ex.y, ex.x + 14, ex.y - 18, { stroke: st(C.ink), w: sel ? 2.5 : 2 }), line(ctx, ex.x, ex.y, ex.x + 14, ex.y + 18, { stroke: st(C.ink), w: sel ? 2.5 : 2 }), line(ctx, ex.x + 14, ex.y - 18, ex.x + 90, ex.y - 18, { stroke: st(C.ink), w: sel ? 2.5 : 2 }), line(ctx, ex.x + 14, ex.y + 18, ex.x + 90, ex.y + 18, { stroke: st(C.ink), w: sel ? 2.5 : 2 }), line(ctx, ex.x + 26, ex.y - 18, ex.x + 26, ex.y + 18, { stroke: st(C.ink), w: sel ? 2.5 : 2, dash: '4 3' })); }
      else if (ex.type === 'prep') { node = s('g', {}, line(ctx, ex.x, ex.y, ex.x + 30, ex.y + 42, { stroke: st(C.ink), w: sel ? 2.5 : 1.5 }), line(ctx, ex.x + 30, ex.y + 42, ex.x + 130, ex.y + 42, { stroke: st(C.ink), w: sel ? 3 : 2 })); }
      else if (ex.type === 'connector') { node = dashedConnector(ctx, ex.x1, ex.y1, ex.x2, ex.y2, ex.label, 0); if (sel) node.firstChild.setAttribute('stroke', C.primary); }
      else if (ex.type === 'arc') { node = s('g', { opacity: sel ? 1 : 0.95 }, s('path', { d: ex.path, fill: 'none', stroke: sel ? C.primary : C.primary, 'stroke-width': sel ? 2.5 : 1.5 }), s('text', { x: ex.cx, y: ex.apex + 12, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 11, 'font-weight': 600, fill: C.primary, 'letter-spacing': '0.3px' }, ex.label), s('polygon', { points: ex.arrow, fill: C.primary })); }
      if (!node) return;
      if (ctx.interactive) { node.style.cursor = 'pointer'; node.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (ctx.activeTool === 'delete') ctx.on.deleteExtra(ex.id); else ctx.on.selectExtra(ex.id); }); }
      g.appendChild(node);
    });
    return g;
  }

  function makeSvg(ctx, width, height) {
    const toolActive = ctx.interactive && ctx.activeTool && ctx.activeTool !== 'pointer';
    const svg = s('svg', { class: 'tj-ss-diagram', viewBox: `0 0 ${width} ${height}`, width, height, style: { 'user-select': 'none', cursor: toolActive ? 'crosshair' : 'default' } });
    if (ctx.interactive && ctx.on.canvasClick) {
      svg.addEventListener('click', (e) => { if (e.target !== svg) return; const p = svgPoint(e, svg); ctx.on.canvasClick(p, e); });
    }
    return svg;
  }

  function renderReedKelloggJohn(ctx) {
    const C = ctx.colors;
    const svg = makeSvg(ctx, 1480, 880);
    const wt = (i, cx, cy, o) => svg.appendChild(wordTile(ctx, ctx.tokens[i], cx, cy, Object.assign({ draggable: ctx.draggable }, o)));
    const ln = (x1, y1, x2, y2, o) => svg.appendChild(line(ctx, x1, y1, x2, y2, o));
    const sm = (i, baseX, baseY, o) => svg.appendChild(slantMod(ctx, ctx.tokens[i], baseX, baseY, o));
    const cl = (x, y, text) => { if (ctx.showClauseLabels) svg.appendChild(s('text', { x, y, 'font-family': FONT, 'font-size': 11, 'font-weight': 500, fill: C.onVar, 'letter-spacing': '0.4px' }, text.toUpperCase())); };
    // "for"
    ln(120, 108, 260, 108, { dash: '5 4', w: 1.5 }); wt(0, 190, 104); ln(195, 112, 195, 150, { dash: '5 4', w: 1.5 }); ln(195, 150, 430, 150, { dash: '5 4', w: 1.5 });
    // Main clause
    cl(250, 208, 'Main clause'); ln(250, 180, 700, 180); ln(368, 144, 368, 220); ln(526, 180, 526, 220);
    wt(1, 308, 172); wt(3, 447, 172); wt(5, 613, 172); sm(2, 420, 180, { length: 64 }); sm(4, 575, 180, { length: 56 });
    svg.appendChild(dashedConnector(ctx, 450, 220, 520, 395, 'that', -2));
    // Result clause
    cl(420, 428, 'Result clause'); ln(420, 400, 900, 400); ln(520, 364, 520, 440); ln(690, 400, 690, 440);
    wt(7, 470, 392); wt(8, 605, 392); wt(11, 790, 392); sm(9, 755, 400, { length: 64 }); sm(10, 820, 400, { length: 64 });
    svg.appendChild(dashedConnector(ctx, 620, 440, 700, 615, 'so that', 2));
    // Purpose clause
    cl(580, 648, 'Purpose clause'); ln(580, 620, 820, 620); ln(820, 584, 820, 660); wt(14, 695, 612);
    ln(835, 595, 1090, 595); ln(835, 645, 1180, 645); ln(820, 620, 835, 595); ln(820, 620, 835, 645);
    wt(18, 880, 587); wt(20, 995, 587); sm(19, 985, 595, { length: 54 }); wt(22, 895, 637); ln(1015, 645, 1015, 680); wt(24, 1100, 637); sm(23, 1075, 645, { length: 56 });
    ln(870, 595, 870, 645, { dash: '5 4', w: 1.5 }); svg.appendChild(s('text', { x: 888, y: 628, 'font-family': FONT, 'font-size': 14, 'font-style': 'italic', fill: C.ink }, 'but'));
    // Relative clause
    svg.appendChild(dashedConnector(ctx, 695, 660, 620, 745)); cl(500, 773, 'Relative clause'); ln(500, 745, 760, 745); ln(605, 709, 605, 785);
    wt(15, 680, 737); ln(680, 745, 720, 790, { w: 1.5 }); ln(720, 790, 830, 790); wt(16, 705, 770, { rotation: 48 }); wt(17, 775, 782);
    svg.appendChild(extrasLayer(ctx));
    return svg;
  }

  function renderAutoReedKellogg(ctx) {
    const C = ctx.colors; const parse = ctx.parse; const tokens = ctx.tokens;
    const modsByHead = {}; (parse.modifiers || []).forEach((m) => { (modsByHead[m.head] = modsByHead[m.head] || []).push(m); });
    const prepsOn = {}; (parse.preps || []).forEach((p) => { (prepsOn[p.attaches_to] = prepsOn[p.attaches_to] || []).push(p); });
    const W = (i) => wordWidth(tokens[i].word);
    const elements = []; let yCursor = 160; const GAP = 210;
    const clausesByParent = { root: [] };
    (parse.clauses || []).forEach((c) => { const p = c.parent == null ? 'root' : c.parent; (clausesByParent[p] = clausesByParent[p] || []).push(c); });

    const slot = (mi) => Math.max(40, W(mi) * 0.62) + 8;
    const fanWidth = (i) => (modsByHead[i] || []).filter((m) => { const t = tokens[m.mod]; return t && t.pos !== 'AUX' && !(m.kind === 'adv' && t.word.toLowerCase() === 'not'); }).reduce((sum, m) => sum + slot(m.mod), 0);
    function layoutClause(clause, baselineLeft) {
      const baselineY = yCursor; yCursor += GAP; let x = baselineLeft + 20; const words = []; let svX = null, voX = null;
      // reserve max(word width, modifier-fan width) so descending slants never
      // bleed into the next baseline word.
      const place = (idx, gap) => { const sw = Math.max(W(idx), fanWidth(idx)); words.push({ idx, cx: x + sw / 2 }); x += sw + (gap == null ? 14 : gap); };
      if (clause.subject != null && tokens[clause.subject]) place(clause.subject);
      if (clause.verb != null && clause.subject != null) { svX = x; x += 14; }
      if (clause.verb != null) {
        const auxes = (modsByHead[clause.verb] || []).filter((m) => tokens[m.mod] && (tokens[m.mod].pos === 'AUX' || (m.kind === 'adv' && tokens[m.mod].word.toLowerCase() === 'not')));
        auxes.forEach((a) => { const w = W(a.mod); words.push({ idx: a.mod, cx: x + w / 2 }); x += w + 10; });
        place(clause.verb);
      }
      if (clause.object != null && clause.verb != null) { voX = x; x += 14; }
      if (clause.object != null && tokens[clause.object]) place(clause.object);
      const baselineRight = x + 20;
      elements.push({ kind: 'baseline', x1: baselineLeft, x2: baselineRight, y: baselineY });
      if (svX != null) elements.push({ kind: 'divider', x: svX, y1: baselineY - 28, y2: baselineY + 22 });
      if (voX != null) elements.push({ kind: 'divider', x: voX, y1: baselineY, y2: baselineY + 22 });
      if (clause.label && ctx.showClauseLabels) elements.push({ kind: 'clauseLabel', x: baselineLeft + 4, y: baselineY + 36, text: clause.label });
      // Space sibling modifiers by their own width so slanted tiles don't
      // overlap, and centre the fan under the word they modify.
      const fanMods = (mods, hostCx, hostBaseY, len) => {
        const totalW = mods.reduce((sum, m) => sum + slot(m.mod), 0);
        let mx = hostCx - totalW / 2;
        mods.forEach((m) => { const sw = slot(m.mod); elements.push({ kind: 'modifier', idx: m.mod, baseX: mx + sw / 2, baseY: hostBaseY, length: len, angle: 62, side: 'right' }); mx += sw; });
      };
      words.forEach((wd) => {
        elements.push({ kind: 'word', idx: wd.idx, cx: wd.cx, cy: baselineY - 8 });
        const nonAux = (modsByHead[wd.idx] || []).filter((m) => { const t = tokens[m.mod]; if (!t) return false; if (t.pos === 'AUX') return false; if (m.kind === 'adv' && t.word.toLowerCase() === 'not') return false; return true; });
        fanMods(nonAux, wd.cx, baselineY, 70);
        (prepsOn[wd.idx] || []).forEach((pp, pi) => {
          const py = baselineY + 96;
          const slantBaseX = wd.cx + pi * 24;
          const baseStartX = slantBaseX + 40;
          elements.push({ kind: 'modifier', idx: pp.prep, baseX: slantBaseX, baseY: baselineY, length: 80, angle: 60, side: 'right' });
          const objW = W(pp.obj); const objCx = baseStartX + objW / 2 + 14;
          elements.push({ kind: 'baseline', x1: baseStartX, x2: baseStartX + objW + 50, y: py });
          elements.push({ kind: 'word', idx: pp.obj, cx: objCx, cy: py - 8 });
          const objMods = (modsByHead[pp.obj] || []).filter((m) => tokens[m.mod] && tokens[m.mod].pos !== 'AUX');
          fanMods(objMods, objCx, py, 56);
        });
      });
      const children = clausesByParent[clause.id] || []; let childLeft = baselineLeft + 80;
      children.forEach((child) => {
        const startX = svX || (baselineLeft + baselineRight) / 2; const startY = baselineY + 24; const childTopY = yCursor;
        elements.push({ kind: 'connector', x1: startX, y1: startY, x2: childLeft + 60, y2: childTopY, label: child.conj != null ? tokens[child.conj].word : '' });
        layoutClause(child, childLeft); childLeft += 100;
      });
    }
    (clausesByParent.root || []).forEach((c, i) => layoutClause(c, 100 + i * 60));
    if (!elements.length) { const by = 200; let x = 100; const ws = tokens.map((t, i) => { const w = W(i); const cx = x + w / 2; x += w + 12; return { idx: i, cx }; }); elements.push({ kind: 'baseline', x1: 80, x2: x + 20, y: by }); ws.forEach((wd) => elements.push({ kind: 'word', idx: wd.idx, cx: wd.cx, cy: by - 8 })); }
    const totalW = Math.max(900, ...elements.filter((e) => e.kind === 'baseline').map((e) => e.x2 || 0)) + 60;
    const totalH = Math.max(420, yCursor + 60);
    const svg = makeSvg(ctx, totalW, totalH);
    elements.forEach((e) => {
      if (e.kind === 'baseline') svg.appendChild(line(ctx, e.x1, e.y, e.x2, e.y));
      else if (e.kind === 'divider') svg.appendChild(line(ctx, e.x, e.y1, e.x, e.y2));
      else if (e.kind === 'clauseLabel') svg.appendChild(s('text', { x: e.x, y: e.y, 'font-family': FONT, 'font-size': 11, 'font-weight': 500, fill: C.onVar, 'letter-spacing': '0.4px' }, e.text.toUpperCase()));
      else if (e.kind === 'word') svg.appendChild(wordTile(ctx, tokens[e.idx], e.cx, e.cy, { draggable: ctx.draggable }));
      else if (e.kind === 'modifier') svg.appendChild(slantMod(ctx, tokens[e.idx], e.baseX, e.baseY, { length: e.length, angle: e.angle, side: e.side }));
      else if (e.kind === 'connector') svg.appendChild(dashedConnector(ctx, e.x1, e.y1, e.x2, e.y2, e.label, 0));
    });
    svg.appendChild(extrasLayer(ctx));
    return svg;
  }

  function treeNodeText(ctx, x, y, label) { return s('text', { x, y, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 13, 'font-weight': 600, fill: ctx.colors.primary }, label); }

  function renderTreeJohn(ctx) {
    const nodes = [
      { id: 'S', x: 740, y: 36, label: 'S' }, { id: 'CONJ_for', x: 120, y: 110, label: 'CONJ' }, { id: 'S_main', x: 380, y: 110, label: 'S' }, { id: 'S_result', x: 740, y: 110, label: 'S′' }, { id: 'S_purp', x: 1120, y: 110, label: 'S″' },
      { id: 'NP_god', x: 220, y: 200, label: 'NP' }, { id: 'VP_main', x: 380, y: 200, label: 'VP' }, { id: 'NP_world', x: 540, y: 200, label: 'NP' }, { id: 'ADV_so', x: 340, y: 280, label: 'ADV' }, { id: 'V_loved', x: 420, y: 280, label: 'V' }, { id: 'DET_the', x: 510, y: 280, label: 'DET' }, { id: 'N_world', x: 570, y: 280, label: 'N' },
      { id: 'CONJ_that', x: 640, y: 200, label: 'CONJ' }, { id: 'NP_he', x: 700, y: 200, label: 'NP' }, { id: 'VP_gave', x: 780, y: 200, label: 'VP' }, { id: 'NP_son', x: 860, y: 200, label: 'NP' }, { id: 'V_gave', x: 780, y: 280, label: 'V' }, { id: 'DET_his', x: 820, y: 280, label: 'DET' }, { id: 'ADJ_only', x: 870, y: 280, label: 'ADJ' }, { id: 'N_son', x: 920, y: 280, label: 'N' },
      { id: 'CONJ_sothat', x: 980, y: 200, label: 'CONJ' }, { id: 'NP_who', x: 1060, y: 200, label: 'NP' }, { id: 'VP_compound', x: 1220, y: 200, label: 'VP' }, { id: 'PRON_who', x: 1020, y: 280, label: 'PRON' }, { id: 'CP_rel', x: 1100, y: 280, label: 'CP' }, { id: 'V_believes', x: 1060, y: 360, label: 'V' }, { id: 'PP_in', x: 1140, y: 360, label: 'PP' }, { id: 'PREP_in', x: 1100, y: 440, label: 'PREP' }, { id: 'PRON_him', x: 1180, y: 440, label: 'PRON' },
      { id: 'VP_perish', x: 1140, y: 280, label: 'VP' }, { id: 'CC_but', x: 1220, y: 280, label: 'CC' }, { id: 'VP_have', x: 1300, y: 280, label: 'VP' }, { id: 'AUX_will1', x: 1090, y: 360, label: 'AUX' }, { id: 'ADV_not', x: 1140, y: 360, label: 'ADV' }, { id: 'V_perish', x: 1190, y: 360, label: 'V' }, { id: 'AUX_will2', x: 1240, y: 360, label: 'AUX' }, { id: 'V_have', x: 1290, y: 360, label: 'V' }, { id: 'NP_life', x: 1350, y: 360, label: 'NP' }, { id: 'ADJ_eternal', x: 1320, y: 440, label: 'ADJ' }, { id: 'N_life', x: 1380, y: 440, label: 'N' },
    ];
    const edges = [['S', 'CONJ_for'], ['S', 'S_main'], ['S', 'S_result'], ['S', 'S_purp'], ['S_main', 'NP_god'], ['S_main', 'VP_main'], ['S_main', 'NP_world'], ['VP_main', 'ADV_so'], ['VP_main', 'V_loved'], ['NP_world', 'DET_the'], ['NP_world', 'N_world'], ['S_result', 'CONJ_that'], ['S_result', 'NP_he'], ['S_result', 'VP_gave'], ['S_result', 'NP_son'], ['VP_gave', 'V_gave'], ['NP_son', 'DET_his'], ['NP_son', 'ADJ_only'], ['NP_son', 'N_son'], ['S_purp', 'CONJ_sothat'], ['S_purp', 'NP_who'], ['S_purp', 'VP_compound'], ['NP_who', 'PRON_who'], ['NP_who', 'CP_rel'], ['CP_rel', 'V_believes'], ['CP_rel', 'PP_in'], ['PP_in', 'PREP_in'], ['PP_in', 'PRON_him'], ['VP_compound', 'VP_perish'], ['VP_compound', 'CC_but'], ['VP_compound', 'VP_have'], ['VP_perish', 'AUX_will1'], ['VP_perish', 'ADV_not'], ['VP_perish', 'V_perish'], ['VP_have', 'AUX_will2'], ['VP_have', 'V_have'], ['VP_have', 'NP_life'], ['NP_life', 'ADJ_eternal'], ['NP_life', 'N_life']];
    const leafMap = { CONJ_for: 0, NP_god: 1, ADV_so: 2, V_loved: 3, DET_the: 4, N_world: 5, CONJ_that: 6, NP_he: 7, V_gave: 8, DET_his: 9, ADJ_only: 10, N_son: 11, CONJ_sothat: 12, PRON_who: 14, V_believes: 15, PREP_in: 16, PRON_him: 17, AUX_will1: 18, ADV_not: 19, V_perish: 20, CC_but: 21, AUX_will2: 18, V_have: 22, ADJ_eternal: 23, N_life: 24 };
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const svg = makeSvg(ctx, 1500, 540);
    edges.forEach(([a, b]) => { const na = byId[a], nb = byId[b]; if (na && nb) svg.appendChild(line(ctx, na.x, na.y + 8, nb.x, nb.y - 14, { w: 1.5 })); });
    nodes.forEach((n) => { if (leafMap[n.id] === undefined) svg.appendChild(treeNodeText(ctx, n.x, n.y, n.label)); });
    nodes.forEach((n) => { const ti = leafMap[n.id]; if (ti === undefined) return; const g = s('g', {}); g.appendChild(treeNodeText(ctx, n.x, n.y - 16, n.label)); g.appendChild(wordTile(ctx, ctx.tokens[ti], n.x, n.y + 8, {})); svg.appendChild(g); });
    svg.appendChild(extrasLayer(ctx));
    return svg;
  }

  function renderTreeAuto(ctx) {
    const tokens = ctx.tokens; const gap = 14; let cursor = 50; const positions = [];
    tokens.forEach((t) => { const w = wordWidth(t.word); positions.push({ cx: cursor + w / 2, w }); cursor += w + gap; });
    const totalW = cursor + 40; const leafY = 360, posY = 320, clauseY = 200, rootY = 100;
    const svg = makeSvg(ctx, totalW, leafY + 60);
    svg.appendChild(treeNodeText(ctx, totalW / 2, rootY, 'S'));
    (ctx.parse.clauses || []).forEach((c) => {
      const toks = c.tokens || []; const xs = toks.map((i) => positions[i] && positions[i].cx).filter((v) => v != null); if (!xs.length) return;
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      svg.appendChild(line(ctx, totalW / 2, rootY + 8, cx, clauseY - 14, { w: 1.5 }));
      svg.appendChild(treeNodeText(ctx, cx, clauseY, c.label || 'S'));
      toks.forEach((ti) => { const p = positions[ti]; if (!p) return; svg.appendChild(line(ctx, cx, clauseY + 8, p.cx, posY - 14, { w: 1.5 })); svg.appendChild(treeNodeText(ctx, p.cx, posY, tokens[ti].pos)); });
    });
    positions.forEach((p, idx) => svg.appendChild(wordTile(ctx, tokens[idx], p.cx, leafY, {})));
    svg.appendChild(extrasLayer(ctx));
    return svg;
  }

  function renderDependency(ctx) {
    const C = ctx.colors; const tokens = ctx.tokens; const gap = 16; let cursor = 60; const positions = [];
    tokens.forEach((t, i) => { const w = wordWidth(t.word); positions.push({ i, cx: cursor + w / 2, w }); cursor += w + gap; });
    const totalW = cursor + 40; const baseY = 420;
    const defaultArcs = [[3, 1, 'nsubj'], [3, 5, 'obj'], [3, 2, 'advmod'], [5, 4, 'det'], [3, 0, 'mark'], [8, 6, 'mark'], [8, 7, 'nsubj'], [8, 11, 'obj'], [11, 9, 'nmod'], [11, 10, 'amod'], [3, 8, 'advcl'], [20, 12, 'mark'], [20, 13, 'mark'], [20, 14, 'nsubj'], [20, 18, 'aux'], [20, 19, 'advmod'], [20, 22, 'conj'], [22, 21, 'cc'], [22, 24, 'obj'], [24, 23, 'amod'], [14, 15, 'acl:relcl'], [15, 17, 'obl'], [17, 16, 'case'], [8, 20, 'advcl']];
    const arcs = ctx.isDefault ? defaultArcs : (ctx.parse.deps || []).map((d) => [d.head, d.dep, d.rel]);
    const svg = makeSvg(ctx, totalW, 560);
    arcs.forEach(([gi, di, label]) => {
      const g = positions[gi], d = positions[di]; if (!g || !d) return;
      const x1 = g.cx, x2 = d.cx, dist = Math.abs(x2 - x1), apex = baseY - 30 - Math.min(220, dist * 0.55), cx = (x1 + x2) / 2;
      const path = `M ${x1} ${baseY - 22} Q ${cx} ${apex} ${x2} ${baseY - 22}`;
      const hi = ctx.selected === gi || ctx.selected === di;
      const grp = s('g', { opacity: ctx.selected != null && !hi ? 0.25 : 1 });
      grp.appendChild(s('path', { d: path, fill: 'none', stroke: C.primary, 'stroke-width': hi ? 2 : 1.2 }));
      grp.appendChild(s('text', { x: cx, y: apex + 12, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 11, 'font-weight': 600, fill: C.primary, 'letter-spacing': '0.3px' }, label));
      grp.appendChild(s('polygon', { points: `${x2 - 4},${baseY - 24} ${x2 + 4},${baseY - 24} ${x2},${baseY - 18}`, fill: C.primary }));
      svg.appendChild(grp);
    });
    positions.forEach((p) => {
      svg.appendChild(wordTile(ctx, tokens[p.i], p.cx, baseY, { width: p.w, selectedOverride: ctx.arcSrc === p.i, depWord: ctx.activeTool === 'arc' }));
      svg.appendChild(s('text', { x: p.cx, y: baseY + 24, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 11, 'font-weight': 600, fill: C.onVar, 'letter-spacing': '0.3px' }, tokens[p.i].pos));
    });
    svg.appendChild(extrasLayer(ctx));
    return svg;
  }

  function renderDiagram(ctx) {
    if (ctx.style === 'tree') return ctx.isDefault ? renderTreeJohn(ctx) : renderTreeAuto(ctx);
    if (ctx.style === 'dep') return renderDependency(ctx);
    return ctx.isDefault ? renderReedKelloggJohn(ctx) : renderAutoReedKellogg(ctx);
  }

  const OVERLAY_COLORS = { ink: 'var(--ink)', inkFaint: 'var(--ink-faint)', primary: 'var(--m3-primary)', onVar: 'var(--m3-on-surface-variant)', pos: (p) => (POS_LOOKUP[p] && POS_LOOKUP[p].swatch) || 'var(--pos-unknown)' };
  const EXPORT_COLORS = { ink: '#1d1b20', inkFaint: '#79747e', primary: '#6750a4', onVar: '#49454f', pos: (p) => POS_HEX[p] || '#E6E0E9' };

  // tokens used by renderers: prefer per-token role/parent/clause from the parse.
  function tokensFromParse(parse) {
    return (parse.tokens || []).map((t) => ({ i: t.i, word: t.word, pos: t.pos, role: t.role, parent: t.parent, clause: t.clause }));
  }

  // static, self-contained SVG string for the entry preview + export.
  function renderPreviewSvg(state) {
    state = normalizeState(state);
    const ctx = {
      tokens: tokensFromParse(state.parse), parse: state.parse, isDefault: state.isDefault, style: state.style,
      selected: null, selectedExtra: null, colorCode: state.colorCode, showClauseLabels: state.showClauseLabels,
      wordOffsets: state.wordOffsets || {}, extras: (state.extras && state.extras[state.style]) || [], activeTool: null,
      draggable: false, arcSrc: null, colors: EXPORT_COLORS, interactive: false, on: {},
    };
    const svg = renderDiagram(ctx);
    const out = s('svg', { xmlns: NS, viewBox: svg.getAttribute('viewBox') || '0 0 600 400', width: '100%', height: 'auto', preserveAspectRatio: 'xMidYMid meet' });
    out.style.maxHeight = '460px';
    while (svg.firstChild) out.appendChild(svg.firstChild);
    if (!(state.parse.tokens || []).length) { out.appendChild(s('text', { x: 20, y: 30, 'font-family': FONT, 'font-size': 14, fill: '#79747e', opacity: 0.6 }, 'Empty sentence diagram')); }
    return out.outerHTML;
  }

  // ── state ────────────────────────────────────────────────────────────────────
  function emptyState() {
    return { sentence: DEFAULT_SENTENCE, parse: defaultParse(), style: 'rk', extras: { rk: [], tree: [], dep: [] }, wordOffsets: {}, colorCode: true, showClauseLabels: true, zoom: 0.7, isDefault: true };
  }
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return emptyState();
    // Legacy LexiGraph state had { canvas, sentence:{rawText,tokens}, nodes } —
    // incompatible shape; reset to a fresh diagram, keeping the raw text.
    if (raw.nodes && raw.sentence && typeof raw.sentence === 'object' && 'rawText' in raw.sentence) {
      const st = emptyState(); st.sentence = raw.sentence.rawText || DEFAULT_SENTENCE; return st;
    }
    const st = emptyState();
    if (typeof raw.sentence === 'string') st.sentence = raw.sentence;
    if (raw.parse && Array.isArray(raw.parse.tokens)) { st.parse = raw.parse; if (!st.parse.clausesMeta) st.parse.clausesMeta = [{ id: 'c1', label: 'Main clause', depth: 0 }]; }
    if (raw.style === 'rk' || raw.style === 'tree' || raw.style === 'dep') st.style = raw.style;
    if (raw.extras && typeof raw.extras === 'object') st.extras = { rk: raw.extras.rk || [], tree: raw.extras.tree || [], dep: raw.extras.dep || [] };
    if (raw.wordOffsets && typeof raw.wordOffsets === 'object') st.wordOffsets = raw.wordOffsets;
    if (typeof raw.colorCode === 'boolean') st.colorCode = raw.colorCode;
    if (typeof raw.showClauseLabels === 'boolean') st.showClauseLabels = raw.showClauseLabels;
    if (typeof raw.zoom === 'number') st.zoom = raw.zoom;
    if (typeof raw.isDefault === 'boolean') st.isDefault = raw.isDefault;
    return st;
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ── styles (injected once, namespaced under .tj-ss-root) ─────────────────────
  function injectStyles() {
    if (document.getElementById('tj-ss-styles')) return;
    const css = `
.tj-ss-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex}
.tj-ss-root{--m3-primary:#6750A4;--m3-on-primary:#fff;--m3-primary-container:#EADDFF;--m3-on-primary-container:#21005D;--m3-secondary-container:#E8DEF8;--m3-on-secondary-container:#1D192B;--m3-surface:#FEF7FF;--m3-on-surface:#1D1B20;--m3-on-surface-variant:#49454F;--m3-surface-container-lowest:#fff;--m3-surface-container-low:#F7F2FA;--m3-surface-container:#F3EDF7;--m3-surface-container-high:#ECE6F0;--m3-outline:#79747E;--m3-outline-variant:#CAC4D0;--m3-error-container:#F9DEDC;--m3-on-error-container:#410E0B;--m3-inverse-surface:#322F35;--m3-inverse-on-surface:#F5EFF7;
--list-05-butter:#FFF2CC;--list-20-pastel-green:#A8E6CF;--list-15-pastel-purple:#E0BBE4;
--pos-noun:#CFE2F3;--pos-verb:#FDE8D4;--pos-adj:#D5E8D4;--pos-adv:#E1D5E7;--pos-pron:#D1ECF1;--pos-prep:#FFF2CC;--pos-conj:#F8D7DA;--pos-det:#F5ECD7;--pos-aux:#D4EDDA;--pos-unknown:#ECE6F0;
--ink:#1d1b20;--ink-faint:#79747e;--on-pastel-strong:#1E1E1E;--radius-card:12px;
font-family:${FONT};color:var(--m3-on-surface);background:var(--m3-surface-container-low);width:100vw;height:100vh;display:grid;grid-template-rows:56px auto 1fr;overflow:hidden}
.tj-ss-root *{box-sizing:border-box}
.tj-ss-topbar{display:flex;align-items:center;gap:16px;padding:0 20px;background:var(--m3-surface);border-bottom:1px solid var(--m3-outline-variant)}
.tj-ss-brand{display:flex;align-items:center;gap:8px;font-size:20px;font-weight:600;letter-spacing:-.2px}
.tj-ss-mark{width:28px;height:28px;border-radius:8px;background:var(--m3-primary);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;letter-spacing:-.4px}
.tj-ss-tabs{display:flex;gap:2px;margin-left:24px}
.tj-ss-tabs button{border:0;background:transparent;padding:8px 14px;border-radius:999px;font:inherit;font-size:13px;font-weight:500;color:var(--m3-on-surface-variant);cursor:pointer}
.tj-ss-tabs button.active{background:var(--m3-secondary-container);color:var(--m3-on-secondary-container)}
.tj-ss-tabs button:hover:not(.active){background:var(--m3-surface-container)}
.tj-ss-grow{flex:1}
.tj-ss-actions{display:flex;gap:8px;align-items:center}
.tj-ss-iconbtn{border:0;background:transparent;width:40px;height:40px;border-radius:999px;display:grid;place-items:center;color:var(--m3-on-surface-variant);cursor:pointer}
.tj-ss-iconbtn:hover{background:var(--m3-surface-container)}
.tj-ss-iconbtn.on{background:var(--m3-secondary-container);color:var(--m3-on-secondary-container)}
.tj-ss-btn{border:0;background:var(--m3-primary);color:#fff;padding:9px 18px;border-radius:999px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.tj-ss-btn:hover{filter:brightness(.94)}
.tj-ss-btn.ghost{background:transparent;color:var(--m3-primary);border:1px solid var(--m3-outline)}
.tj-ss-btn.ghost:hover{background:var(--m3-primary-container)}
.tj-ss-btn:disabled{opacity:.5;cursor:default}
.tj-ss-strip{background:var(--m3-surface);border-bottom:1px solid var(--m3-outline-variant);padding:16px 20px 12px;display:flex;flex-direction:column;gap:12px}
.tj-ss-inputrow{display:flex;align-items:center;gap:12px}
.tj-ss-inputrow .lbl{font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--m3-on-surface-variant);flex-shrink:0;min-width:76px}
.tj-ss-input{flex:1;border:1px solid var(--m3-outline-variant);background:var(--m3-surface-container-low);border-radius:12px;padding:12px 16px;font:inherit;font-size:15px;color:var(--m3-on-surface);outline:none}
.tj-ss-input:focus{border-color:var(--m3-primary);background:var(--m3-surface)}
.tj-ss-status{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--m3-on-surface-variant);font-weight:500;white-space:nowrap}
.tj-ss-status .dot{width:8px;height:8px;border-radius:999px;background:var(--list-20-pastel-green);box-shadow:0 0 0 3px rgba(168,230,207,.3)}
.tj-ss-chips{display:flex;flex-wrap:wrap;gap:6px}
.tj-ss-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font:inherit;font-size:13px;font-weight:500;color:var(--on-pastel-strong);cursor:pointer;border:1.5px solid transparent}
.tj-ss-chip:hover{filter:brightness(.97)}
.tj-ss-chip.selected{border-color:var(--m3-primary);box-shadow:0 0 0 3px rgba(103,80,164,.15)}
.tj-ss-body{display:grid;grid-template-columns:1fr 320px;min-height:0;position:relative}
.tj-ss-canvaswrap{position:relative;background:radial-gradient(circle,rgba(73,69,79,.10) 1px,transparent 1px) 0 0 / 24px 24px,var(--m3-surface-container-low);overflow:auto;display:flex;flex-direction:column}
.tj-ss-ctoolbar{display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--m3-surface);border-bottom:1px solid var(--m3-outline-variant);position:sticky;top:0;z-index:5;flex-wrap:wrap}
.tj-ss-styletoggle{display:inline-flex;background:var(--m3-surface-container);border-radius:999px;padding:3px;gap:2px}
.tj-ss-styletoggle button{border:0;background:transparent;padding:6px 14px;border-radius:999px;font:inherit;font-size:13px;font-weight:500;color:var(--m3-on-surface-variant);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.tj-ss-styletoggle button.active{background:var(--m3-surface);color:var(--m3-on-surface);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.tj-ss-cmeta{margin-left:auto;display:flex;align-items:center;gap:12px;font-size:11px;color:var(--m3-on-surface-variant)}
.tj-ss-zoom{display:inline-flex;align-items:center;gap:4px;background:var(--m3-surface-container);border-radius:999px;padding:2px}
.tj-ss-zoom button{width:28px;height:28px;border:0;background:transparent;border-radius:999px;cursor:pointer;color:var(--m3-on-surface-variant);display:grid;place-items:center}
.tj-ss-zoom button:hover{background:var(--m3-surface)}
.tj-ss-zoom .pct{font-size:11px;font-weight:500;color:var(--m3-on-surface-variant);min-width:38px;text-align:center}
.tj-ss-canvas{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:24px 20px;min-height:0}
.tj-ss-togglepill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font:inherit;font-size:13px;font-weight:500;border:1px solid var(--m3-outline-variant);background:var(--m3-surface);color:var(--m3-on-surface-variant);cursor:pointer}
.tj-ss-togglepill:hover{background:var(--m3-surface-container)}
.tj-ss-togglepill.on{background:var(--m3-primary);color:#fff;border-color:var(--m3-primary)}
.tj-ss-togglepill .dot{width:8px;height:8px;border-radius:999px;background:currentColor;opacity:.6}
.tj-ss-togglepill.on .dot{background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.25);opacity:1}
.tj-ss-diagram{font-family:${FONT}}
.tj-ss-word-tile.drag rect:hover{stroke:var(--m3-primary);stroke-width:2;cursor:grab}
.tj-ss-word-tile:not(.sel):hover rect{stroke:var(--m3-primary);stroke-width:1.5;stroke-dasharray:3 3}
.tj-ss-inspector{background:var(--m3-surface);border-left:1px solid var(--m3-outline-variant);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.tj-ss-itabs{display:flex;border-bottom:1px solid var(--m3-outline-variant)}
.tj-ss-itabs button{flex:1;border:0;background:transparent;padding:14px 0;font:inherit;font-size:13px;font-weight:500;color:var(--m3-on-surface-variant);cursor:pointer;position:relative}
.tj-ss-itabs button.active{color:var(--m3-primary)}
.tj-ss-itabs button.active::after{content:'';position:absolute;left:16px;right:16px;bottom:0;height:3px;background:var(--m3-primary);border-radius:2px 2px 0 0}
.tj-ss-ibody{flex:1;overflow:auto;padding:20px}
.tj-ss-iempty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 16px;color:var(--m3-on-surface-variant);gap:12px}
.tj-ss-iempty svg{color:var(--m3-outline)}
.tj-ss-isec{margin-bottom:20px}
.tj-ss-ilabel{font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--m3-on-surface-variant);margin-bottom:8px}
.tj-ss-iword{font-size:28px;font-weight:600;letter-spacing:-.3px;margin:4px 0}
.tj-ss-posbadge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:500;color:var(--on-pastel-strong)}
.tj-ss-kv{display:grid;grid-template-columns:100px 1fr;gap:6px 12px;font-size:13px}
.tj-ss-kv .k{color:var(--m3-on-surface-variant);font-weight:500}
.tj-ss-posgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tj-ss-posgrid button{border:1.5px solid transparent;border-radius:8px;padding:8px 10px;font:inherit;font-size:11px;font-weight:500;color:var(--on-pastel-strong);cursor:pointer;text-align:left}
.tj-ss-posgrid button.active{border-color:var(--m3-primary);box-shadow:0 0 0 3px rgba(103,80,164,.15)}
.tj-ss-outline{display:flex;flex-direction:column;gap:2px}
.tj-ss-orow{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;font-size:13px;cursor:pointer}
.tj-ss-orow:hover{background:var(--m3-surface-container)}
.tj-ss-orow .role{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--m3-on-surface-variant);min-width:48px;font-weight:600}
.tj-ss-orow .marker{width:6px;height:6px;border-radius:999px;background:var(--m3-primary);opacity:.6;flex-shrink:0}
.tj-ss-palette{position:absolute;top:64px;left:16px;width:232px;background:var(--m3-surface);border:1px solid var(--m3-outline-variant);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.12);display:flex;flex-direction:column;z-index:10;max-height:calc(100% - 80px);overflow:hidden}
.tj-ss-phead{display:flex;align-items:flex-start;justify-content:space-between;padding:12px 12px 8px 16px;gap:8px}
.tj-ss-peyebrow{font-size:9px;font-weight:700;letter-spacing:1px;color:var(--m3-primary);margin-bottom:2px}
.tj-ss-ptitle{font-size:16px;font-weight:600;letter-spacing:-.2px}
.tj-ss-toolgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;padding:4px 10px 10px;overflow:auto}
.tj-ss-tool{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:12px 6px 9px;border:1px solid var(--m3-outline-variant);background:var(--m3-surface-container-low);border-radius:10px;font:inherit;cursor:pointer;color:var(--m3-on-surface)}
.tj-ss-tool:hover{background:var(--m3-surface-container)}
.tj-ss-tool.active{background:var(--m3-secondary-container);border-color:var(--m3-primary);color:var(--m3-on-secondary-container);box-shadow:inset 0 0 0 1px var(--m3-primary)}
.tj-ss-tool .ti{color:var(--m3-on-surface-variant);height:22px}
.tj-ss-tool.active .ti{color:var(--m3-primary)}
.tj-ss-tlabel{font-size:11px;font-weight:500;text-align:center;line-height:13px}
.tj-ss-pfoot{border-top:1px solid var(--m3-outline-variant);padding:10px 14px 12px;background:var(--m3-surface-container-lowest)}
.tj-ss-hint{font-size:12px;line-height:16px;color:var(--m3-on-surface);margin-bottom:8px}
.tj-ss-hint b{display:block;font-size:9px;font-weight:700;letter-spacing:.5px;color:var(--m3-on-surface-variant);margin-bottom:2px}
.tj-ss-pmeta{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--m3-on-surface-variant);font-weight:500}
.tj-ss-link{border:0;background:none;color:var(--m3-primary);cursor:pointer;font:inherit;font-weight:600;font-size:11px;text-decoration:underline}
.tj-ss-toast{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);background:var(--m3-inverse-surface);color:var(--m3-inverse-on-surface);padding:10px 18px;border-radius:999px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:20}
.tj-ss-toast.error{background:var(--m3-error-container);color:var(--m3-on-error-container)}
.tj-ss-spin{width:14px;height:14px;border-radius:999px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:tjssspin .8s linear infinite}
@keyframes tjssspin{to{transform:rotate(360deg)}}
.tj-ss-lessons{display:grid;grid-template-columns:320px 1fr;height:100%;background:var(--m3-surface-container-low);grid-column:1 / -1}
.tj-ss-llist{background:var(--m3-surface);border-right:1px solid var(--m3-outline-variant);overflow:auto;padding:16px 12px}
.tj-ss-ltitle{font-size:11px;text-transform:uppercase;font-weight:600;color:var(--m3-on-surface-variant);letter-spacing:.5px;padding:0 12px;margin-bottom:8px}
.tj-ss-lcard{padding:12px 14px;border-radius:12px;cursor:pointer;margin-bottom:4px;display:flex;align-items:center;gap:12px}
.tj-ss-lcard:hover{background:var(--m3-surface-container)}
.tj-ss-lcard.active{background:var(--m3-secondary-container)}
.tj-ss-lcard .stripe{width:4px;align-self:stretch;border-radius:999px;background:var(--m3-primary)}
.tj-ss-lcard .lct{flex:1;min-width:0}
.tj-ss-lcard .lct .t{font-size:13px;font-weight:600}
.tj-ss-lcard .lct .sub{font-size:12px;color:var(--m3-on-surface-variant);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tj-ss-pill{font-size:10px;font-weight:700;letter-spacing:.5px;padding:3px 7px;border-radius:999px;background:var(--list-20-pastel-green);color:var(--on-pastel-strong)}
.tj-ss-pill.locked{background:var(--m3-surface-container-high);color:var(--m3-on-surface-variant)}
.tj-ss-pill.now{background:var(--m3-primary-container);color:var(--m3-on-primary-container)}
.tj-ss-ldetail{padding:32px 40px;overflow:auto;max-width:760px;margin:0 auto;width:100%}
.tj-ss-ldetail h1{font-size:32px;line-height:38px;font-weight:700;letter-spacing:-.5px;margin:0 0 6px}
.tj-ss-crumb{font-size:11px;color:var(--m3-on-surface-variant);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:12px}
.tj-ss-intro{font-size:15px;color:var(--m3-on-surface-variant);line-height:24px;margin-bottom:24px}
.tj-ss-pcard{background:var(--m3-surface);border-radius:12px;padding:20px;margin-bottom:24px;display:flex;align-items:center;gap:20px}
.tj-ss-pbar{flex:1;height:8px;background:var(--m3-surface-container);border-radius:999px;overflow:hidden}
.tj-ss-pbar>div{height:100%;background:var(--m3-primary);border-radius:999px}
.tj-ss-step{background:var(--m3-surface);border-radius:12px;padding:20px;margin-bottom:12px;display:flex;gap:16px;align-items:flex-start}
.tj-ss-stepnum{width:32px;height:32px;border-radius:999px;background:var(--m3-primary-container);color:var(--m3-on-primary-container);display:grid;place-items:center;font-weight:700;flex-shrink:0}
.tj-ss-library{padding:32px 40px;overflow:auto;max-width:1000px;margin:0 auto;width:100%;grid-column:1 / -1}
.tj-ss-libgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.tj-ss-libcard{background:var(--m3-surface);border-radius:12px;padding:16px;border:1px solid var(--m3-outline-variant)}
.tj-ss-footer{position:absolute;bottom:16px;right:24px;display:flex;gap:8px;z-index:30}
@media (max-width:1100px){.tj-ss-body{grid-template-columns:1fr 280px}}
`;
    document.head.appendChild(h('style', { id: 'tj-ss-styles', text: css }));
  }

  // ── tools (ported from edit-palette.jsx) ─────────────────────────────────────
  const TOOLS = {
    rk: [
      { id: 'pointer', label: 'Select', icon: 'pointer', hint: 'Click to select, drag to move' },
      { id: 'word', label: 'Word', icon: 'word', hint: 'Click on canvas to place a new word' },
      { id: 'baseline', label: 'Baseline', icon: 'baseline', hint: 'Click to add a horizontal baseline' },
      { id: 'modifier', label: 'Modifier', icon: 'modifier', hint: 'Click to add a slanted modifier' },
      { id: 'vertical', label: 'Vertical', icon: 'vertical', hint: 'Click to add a vertical divider' },
      { id: 'pedestal', label: 'Pedestal', icon: 'pedestal', hint: 'Click to add an upward stem' },
      { id: 'fork', label: 'Fork', icon: 'fork', hint: 'Click to add a compound-predicate fork' },
      { id: 'prep', label: 'Prep. Phrase', icon: 'prep', hint: 'Click to add a prepositional phrase' },
      { id: 'connect', label: 'Connector', icon: 'dashed', hint: 'Click to add a dashed connector' },
      { id: 'delete', label: 'Delete', icon: 'trash', hint: 'Click an element to remove it' },
    ],
    tree: [
      { id: 'pointer', label: 'Select', icon: 'pointer', hint: 'Click a node to select' },
      { id: 'addnode', label: 'Add Child', icon: 'add', hint: 'Click canvas to add a labeled node' },
      { id: 'rename', label: 'Rename', icon: 'edit', hint: 'Click a node to rename (coming soon)' },
      { id: 'delete', label: 'Delete', icon: 'trash', hint: 'Click a node to remove it' },
    ],
    dep: [
      { id: 'pointer', label: 'Select', icon: 'pointer', hint: 'Click a word or arc to select' },
      { id: 'arc', label: 'Draw Arc', icon: 'arc', hint: 'Click governor, then dependent' },
      { id: 'relabel', label: 'Edit Label', icon: 'edit', hint: 'Click an arc to relabel (coming soon)' },
      { id: 'delete', label: 'Delete', icon: 'trash', hint: 'Click an arc to remove it' },
    ],
  };
  const STYLE_NAME = { rk: 'Reed-Kellogg', tree: 'Tree', dep: 'Dependency' };

  const LESSONS = [
    { id: 1, title: 'Subject + Verb', sub: 'The dog runs.', status: 'done', swatch: '#CFE2F3' },
    { id: 2, title: 'Direct Objects', sub: 'She caught the ball.', status: 'done', swatch: '#FDE8D4' },
    { id: 3, title: 'Adjectives & Adverbs', sub: 'The quick brown fox jumps.', status: 'current', swatch: '#D5E8D4' },
    { id: 4, title: 'Prepositional Phrases', sub: 'A book on the table.', status: 'locked', swatch: '#FFF2CC' },
    { id: 5, title: 'Compound Predicates', sub: 'She sang and danced.', status: 'locked', swatch: '#F8D7DA' },
    { id: 6, title: 'Subordinate Clauses', sub: 'He left because it rained.', status: 'locked', swatch: '#E1D5E7' },
    { id: 7, title: 'Relative Clauses', sub: 'The man who sang…', status: 'locked', swatch: '#D1ECF1' },
    { id: 8, title: 'Capstone: John 3:16', sub: 'Putting it all together.', status: 'locked', swatch: '#E0BBE4' },
  ];
  const LIBRARY = [
    { tag: 'Classic', sentence: 'The quick brown fox jumps over a lazy dog.' },
    { tag: 'Alliteration', sentence: 'She sells seashells by the seashore.' },
    { tag: 'Subord clause', sentence: 'When the rain stops, we will go outside.' },
    { tag: 'Relative clause', sentence: 'The book that I bought yesterday is on the table.' },
    { tag: 'Capstone', sentence: 'For God so loved the world that He gave His only Son…' },
    { tag: 'Compound', sentence: 'In the beginning was the Word, and the Word was with God.' },
    { tag: 'Correlative', sentence: 'Either you finish your work or you stay after class.' },
    { tag: 'Participle', sentence: 'Running quickly, she caught the bus just in time.' },
  ];

  // ── the full-screen Studio overlay ───────────────────────────────────────────
  function openStudio(initialState, onSave) {
    if (window.__tjSentenceStudioOpen && document.querySelector('.tj-ss-overlay')) return;
    window.__tjSentenceStudioOpen = true;
    injectStyles();

    let st = normalizeState(initialState);
    let draft = st.sentence;        // the sentence input's live text (survives re-renders)
    let tab = 'workspace';
    let selected = null, selectedExtra = null, editMode = false, activeTool = 'pointer', arcSrc = null;
    let parsing = false, toast = null, toastTimer = null;
    let lessonActive = 3;
    let uid = 0; const newId = () => 'e' + Date.now().toString(36) + (uid++);
    let canvasInnerRef = null;      // current diagram host (for in-place drag re-render)
    let wordDrag = null;            // active word-tile drag

    const overlay = h('div', { class: 'tj-ss-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } });
    const root = h('div', { class: 'tj-ss-root', onmousedown: (e) => e.stopPropagation() });
    overlay.appendChild(root);
    document.body.appendChild(overlay);

    // Word drag runs on the persistent root (not the tile, which gets recreated
    // each diagram re-render). The CTM inverse is cached at dragStart so the
    // coordinate mapping is stable even as the svg element is replaced.
    function startWordDrag(i, e) {
      const svg = canvasInnerRef && canvasInnerRef.querySelector('.tj-ss-diagram');
      const ctm = svg && svg.getScreenCTM ? svg.getScreenCTM() : null;
      const inv = ctm ? ctm.inverse() : null;
      const toLocal = (cx, cy) => {
        if (!svg || !inv || !svg.createSVGPoint) return { x: cx, y: cy };
        const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; const p = pt.matrixTransform(inv); return { x: p.x, y: p.y };
      };
      const start = toLocal(e.clientX, e.clientY);
      const off = st.wordOffsets[i] || {};
      wordDrag = { idx: i, sx: start.x, sy: start.y, dx0: off.dx || 0, dy0: off.dy || 0, moved: false, toLocal };
      try { root.setPointerCapture(e.pointerId); } catch {}
    }
    root.addEventListener('pointermove', (e) => {
      if (!wordDrag) return;
      const cur = wordDrag.toLocal(e.clientX, e.clientY);
      const nx = wordDrag.dx0 + (cur.x - wordDrag.sx), ny = wordDrag.dy0 + (cur.y - wordDrag.sy);
      if (Math.abs(nx - wordDrag.dx0) > 2 || Math.abs(ny - wordDrag.dy0) > 2) wordDrag.moved = true;
      st.wordOffsets[wordDrag.idx] = { dx: nx, dy: ny };
      renderDiagramOnly();
    });
    const endWordDrag = (e) => {
      if (!wordDrag) return;
      const w = wordDrag; wordDrag = null;
      try { root.releasePointerCapture(e.pointerId); } catch {}
      if (!w.moved) setSelected(w.idx); // a tap, not a drag → select
    };
    root.addEventListener('pointerup', endWordDrag);
    root.addEventListener('pointercancel', endWordDrag);

    function renderDiagramOnly() {
      if (!canvasInnerRef) { render(); return; }
      canvasInnerRef.innerHTML = '';
      canvasInnerRef.appendChild(renderDiagram(diagramCtx()));
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      if (toastTimer) clearTimeout(toastTimer);
      overlay.remove();
      window.__tjSentenceStudioOpen = false;
    }
    function saveAndClose() {
      onSave({ state: clone(st), previewSvg: renderPreviewSvg(st) });
      close();
    }

    function tokens() { return tokensFromParse(st.parse); }
    function setStyle(style) { st.style = style; selectedExtra = null; arcSrc = null; render(); }
    function setSelected(i) { selected = i; selectedExtra = null; render(); }
    function setTab(t) { tab = t; render(); }

    function showToast(t) { toast = t; if (toastTimer) clearTimeout(toastTimer); if (t && !t.parsing) toastTimer = setTimeout(() => { toast = null; render(); }, t.error ? 5000 : 3500); }

    async function reparse(text) {
      const target = String(text || '').trim();
      if (!target || parsing) return;
      draft = target; // reflect the attempted sentence in the input even if parse errors
      parsing = true; showToast({ parsing: true }); render();
      try {
        const t0 = (window.performance && performance.now()) || Date.now();
        const result = await parseSentence(target);
        const ms = Math.round(((window.performance && performance.now()) || Date.now()) - t0);
        if (!result || !result.tokens || !result.tokens.length) throw new Error('Empty parse');
        st.parse = result; st.sentence = target; st.isDefault = false;
        st.extras = { rk: [], tree: [], dep: [] }; st.wordOffsets = {};
        selected = null; selectedExtra = null;
        showToast({ info: `Parsed in ${ms}ms · ${result.tokens.length} tokens · ${(result.clauses || []).length} clauses` });
      } catch (e) {
        showToast({ error: (e && e.message) || String(e) });
      } finally { parsing = false; render(); }
    }
    function resetDefault() { st = emptyState(); draft = st.sentence; selected = null; selectedExtra = null; render(); }
    function setPos(i, code) { st.parse = clone(st.parse); const t = st.parse.tokens.find((x) => x.i === i); if (t) t.pos = code; render(); }

    function addExtra(extra) { const key = st.style; st.extras[key] = (st.extras[key] || []).concat([Object.assign({ id: newId() }, extra)]); render(); }
    function deleteExtra(id) { const key = st.style; st.extras[key] = (st.extras[key] || []).filter((e) => e.id !== id); if (selectedExtra === id) selectedExtra = null; render(); }
    function clearExtras() { st.extras[st.style] = []; render(); }

    function onCanvasClick(p) {
      if (!editMode || !p) return;
      const { x, y } = p;
      if (st.style === 'rk') {
        if (activeTool === 'word') { const t = prompt('New word:', 'word'); if (t) addExtra({ type: 'word', x, y, text: t, pos: 'NOUN' }); }
        else if (activeTool === 'modifier') { const t = prompt('Modifier word:', 'modifier'); if (t) addExtra({ type: 'modifier', x, y, length: 60, angle: 60, side: 'right', text: t }); }
        else if (activeTool === 'baseline') addExtra({ type: 'baseline', x1: x - 90, x2: x + 90, y });
        else if (activeTool === 'vertical') addExtra({ type: 'vertical', x, y1: y - 24, y2: y + 24 });
        else if (activeTool === 'pedestal') addExtra({ type: 'pedestal', x, y });
        else if (activeTool === 'fork') addExtra({ type: 'fork', x, y });
        else if (activeTool === 'prep') addExtra({ type: 'prep', x, y });
        else if (activeTool === 'connect') addExtra({ type: 'connector', x1: x, y1: y, x2: x + 120, y2: y + 80, label: 'that' });
      } else if (st.style === 'tree') {
        if (activeTool === 'addnode') { const l = prompt('Node label:', 'NP'); if (l) addExtra({ type: 'word', x, y, text: l, pos: 'NOUN' }); }
      } else if (st.style === 'dep') { arcSrc = null; render(); }
    }
    function onDepWord(i) {
      if (activeTool !== 'arc') { setSelected(i); return; }
      if (arcSrc == null) { arcSrc = i; render(); }
      else if (arcSrc !== i) { addArc(arcSrc, i); arcSrc = null; }
    }
    function addArc(gov, dep) {
      const toks = tokens(); let cursor = 60; const positions = toks.map((t) => { const w = wordWidth(t.word); const cx = cursor + w / 2; cursor += w + 16; return cx; });
      const x1 = positions[gov], x2 = positions[dep]; if (x1 == null || x2 == null) return;
      const baseY = 420, dist = Math.abs(x2 - x1), apex = baseY - 30 - Math.min(220, dist * 0.55), cx = (x1 + x2) / 2;
      const path = `M ${x1} ${baseY - 22} Q ${cx} ${apex} ${x2} ${baseY - 22}`;
      const arrow = `${x2 - 4},${baseY - 24} ${x2 + 4},${baseY - 24} ${x2},${baseY - 18}`;
      const label = prompt('Relation label:', 'nsubj') || 'rel';
      addExtra({ type: 'arc', path, apex, cx, arrow, label, gov, dep });
    }

    function onKey(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') { close(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedExtra != null) { e.preventDefault(); deleteExtra(selectedExtra); }
    }
    document.addEventListener('keydown', onKey, true);

    // ── view builders ──────────────────────────────────────────────────────────
    function buildTopBar() {
      const tabBtn = (id, label) => h('button', { class: tab === id ? 'active' : '', onclick: () => setTab(id) }, label);
      return h('div', { class: 'tj-ss-topbar' },
        h('div', { class: 'tj-ss-brand' }, h('span', { class: 'tj-ss-mark' }, 'S'), h('span', {}, 'Sentence Studio')),
        h('nav', { class: 'tj-ss-tabs' }, tabBtn('workspace', 'Workspace'), tabBtn('lessons', 'Lessons'), tabBtn('library', 'Library')),
        h('div', { class: 'tj-ss-grow' }),
        h('div', { class: 'tj-ss-actions' },
          h('button', { class: 'tj-ss-iconbtn', title: 'Export SVG', onclick: exportSvg }, icon('download', 20)),
          h('button', { class: 'tj-ss-btn ghost', onclick: saveAndClose }, icon('download', 18), 'Save'),
        ),
      );
    }

    function buildStrip() {
      const toks = tokens();
      const input = h('input', { class: 'tj-ss-input', type: 'text', value: draft, placeholder: 'Type a sentence to diagram…' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reparse(input.value); } });
      const dirty = () => input.value.trim() !== st.sentence.trim();
      const parseBtn = h('button', { class: 'tj-ss-btn ghost', disabled: parsing, onclick: () => reparse(input.value) }, icon('auto_awesome', 16), parsing ? 'Parsing…' : (dirty() ? 'Parse' : 'Re-parse'));
      // keep the draft (used to rebuild the input on re-render) in sync with typing
      input.addEventListener('input', () => { draft = input.value; parseBtn.lastChild.textContent = parsing ? 'Parsing…' : (dirty() ? 'Parse' : 'Re-parse'); });
      const status = h('div', { class: 'tj-ss-status' }, h('span', { class: 'dot', style: { background: parsing ? 'var(--list-05-butter)' : 'var(--list-20-pastel-green)' } }), parsing ? 'Parsing' : `Parsed · ${toks.length} tokens · ${(st.parse.clauses || []).length} clauses`);
      const chips = h('div', { class: 'tj-ss-chips' }, toks.map((t) => h('button', {
        class: 'tj-ss-chip' + (selected === t.i ? ' selected' : ''),
        style: { background: (POS_LOOKUP[t.pos] && POS_LOOKUP[t.pos].swatch) || 'var(--pos-unknown)' },
        title: POS_LOOKUP[t.pos] && POS_LOOKUP[t.pos].label, onclick: () => setSelected(t.i),
      }, t.word)));
      const row = h('div', { class: 'tj-ss-inputrow' }, h('div', { class: 'lbl' }, 'Sentence'), input, parseBtn);
      if (!st.isDefault) row.appendChild(h('button', { class: 'tj-ss-btn ghost', title: 'Reset to John 3:16', onclick: resetDefault }, 'Reset'));
      row.appendChild(status);
      return h('div', { class: 'tj-ss-strip' }, row, chips);
    }

    function buildCanvasToolbar() {
      const styleBtn = (id, ic) => h('button', { class: st.style === id ? 'active' : '', onclick: () => setStyle(id) }, icon(ic, 18), STYLE_NAME[id]);
      const zoomBtn = (ic, fn, t) => h('button', { title: t, onclick: fn }, icon(ic, 18));
      return h('div', { class: 'tj-ss-ctoolbar' },
        h('div', { class: 'tj-ss-styletoggle' }, styleBtn('rk', 'horizontal_rule'), styleBtn('tree', 'account_tree'), styleBtn('dep', 'sync_alt')),
        h('button', { class: 'tj-ss-iconbtn' + (st.colorCode ? ' on' : ''), title: 'Toggle POS color coding', onclick: () => { st.colorCode = !st.colorCode; render(); } }, icon('palette', 20)),
        h('button', { class: 'tj-ss-iconbtn' + (st.showClauseLabels ? ' on' : ''), title: 'Toggle clause labels', onclick: () => { st.showClauseLabels = !st.showClauseLabels; render(); } }, icon('label', 20)),
        h('div', { class: 'tj-ss-cmeta' },
          h('button', { class: 'tj-ss-togglepill' + (editMode ? ' on' : ''), onclick: () => { editMode = !editMode; if (!editMode) activeTool = 'pointer'; render(); } }, icon('edit', 16), editMode ? 'Editing' : 'Edit'),
          h('span', {}, st.isDefault ? 'John 3:16' : 'Custom sentence'),
          h('div', { class: 'tj-ss-zoom' },
            zoomBtn('remove', () => { st.zoom = Math.max(0.4, +(st.zoom - 0.1).toFixed(2)); render(); }, 'Zoom out'),
            h('span', { class: 'pct' }, Math.round(st.zoom * 100) + '%'),
            zoomBtn('add', () => { st.zoom = Math.min(2.0, +(st.zoom + 0.1).toFixed(2)); render(); }, 'Zoom in'),
            zoomBtn('fit_screen', () => { st.zoom = 1.0; render(); }, 'Fit'),
          ),
        ),
      );
    }

    function diagramCtx() {
      return {
        tokens: tokens(), parse: st.parse, isDefault: st.isDefault, style: st.style,
        selected, selectedExtra, colorCode: st.colorCode, showClauseLabels: st.showClauseLabels,
        wordOffsets: st.wordOffsets, extras: (st.extras && st.extras[st.style]) || [],
        activeTool: editMode ? activeTool : null, draggable: editMode && activeTool === 'pointer', arcSrc,
        colors: OVERLAY_COLORS, interactive: true,
        on: { select: setSelected, dragStart: startWordDrag, canvasClick: onCanvasClick, selectExtra: (id) => { selectedExtra = id; selected = null; render(); }, deleteExtra, depWord: onDepWord },
      };
    }

    function buildPalette() {
      const tools = TOOLS[st.style] || TOOLS.rk;
      const active = tools.find((t) => t.id === activeTool) || tools[0];
      const exCount = ((st.extras && st.extras[st.style]) || []).length;
      const grid = h('div', { class: 'tj-ss-toolgrid' }, tools.map((t) => h('button', { class: 'tj-ss-tool' + (activeTool === t.id ? ' active' : ''), title: t.hint, onclick: () => { activeTool = t.id; arcSrc = null; render(); } }, h('span', { class: 'ti' }, toolIcon(t.icon)), h('span', { class: 'tj-ss-tlabel' }, t.label))));
      const foot = h('div', { class: 'tj-ss-pfoot' },
        h('div', { class: 'tj-ss-hint' }, h('b', {}, 'HINT'), active.hint),
        h('div', { class: 'tj-ss-pmeta' }, h('span', {}, exCount + ' added'), exCount > 0 ? h('button', { class: 'tj-ss-link', onclick: clearExtras }, 'Clear all') : null),
      );
      return h('div', { class: 'tj-ss-palette' },
        h('div', { class: 'tj-ss-phead' }, h('div', {}, h('div', { class: 'tj-ss-peyebrow' }, 'EDIT MODE'), h('div', { class: 'tj-ss-ptitle' }, STYLE_NAME[st.style])), h('button', { class: 'tj-ss-iconbtn', title: 'Exit edit mode', onclick: () => { editMode = false; activeTool = 'pointer'; render(); } }, icon('remove', 18))),
        grid, foot,
      );
    }

    function buildInspector() {
      const toks = tokens();
      const token = selected != null ? toks.find((t) => t.i === selected) : null;
      let iTabState = buildInspector._tab || 'word';
      buildInspector._tab = iTabState;
      const body = h('div', { class: 'tj-ss-ibody' });
      const setITab = (t) => { buildInspector._tab = t; render(); };
      const tabs = h('div', { class: 'tj-ss-itabs' }, h('button', { class: iTabState === 'word' ? 'active' : '', onclick: () => setITab('word') }, 'Word'), h('button', { class: iTabState === 'outline' ? 'active' : '', onclick: () => setITab('outline') }, 'Outline'));

      if (iTabState === 'word') {
        if (!token) {
          body.appendChild(h('div', { class: 'tj-ss-iempty' }, icon('touch_app', 36), h('h3', {}, 'Tap a word to inspect'), h('p', {}, 'Click any chip above or word in the diagram to see its part of speech, role, and how it connects.')));
        } else {
          const posDef = POS_LOOKUP[token.pos] || { label: token.pos, swatch: 'var(--pos-unknown)', desc: '' };
          const role = ROLE_LABELS[token.role] || token.role || '—';
          const parent = token.parent != null ? toks.find((t) => t.i === token.parent) : null;
          const clauseMeta = (st.parse.clausesMeta || []).find((c) => c.id === token.clause);
          const kv = h('div', { class: 'tj-ss-kv' }, h('div', { class: 'k' }, 'Function'), h('div', { class: 'v' }, role));
          if (parent) { kv.appendChild(h('div', { class: 'k' }, 'Attaches to')); kv.appendChild(h('div', { class: 'v' }, h('a', { style: { color: 'var(--m3-primary)', cursor: 'pointer', 'text-decoration': 'underline' }, onclick: () => setSelected(parent.i) }, parent.word))); }
          kv.appendChild(h('div', { class: 'k' }, 'Clause')); kv.appendChild(h('div', { class: 'v' }, clauseMeta ? clauseMeta.label : '—'));
          kv.appendChild(h('div', { class: 'k' }, 'Position')); kv.appendChild(h('div', { class: 'v' }, `#${token.i + 1} of ${toks.length}`));
          const posGrid = h('div', { class: 'tj-ss-posgrid' }, POS_DEFS.map((p) => h('button', { class: token.pos === p.code ? 'active' : '', style: { background: p.swatch }, onclick: () => setPos(token.i, p.code) }, p.label)));
          body.appendChild(h('div', { class: 'tj-ss-isec' }, h('div', { class: 'tj-ss-ilabel' }, 'Word'), h('div', { class: 'tj-ss-iword' }, token.word), h('div', { class: 'tj-ss-posbadge', style: { background: posDef.swatch } }, icon('category', 14), posDef.label), h('p', { style: { 'margin-top': '8px', color: 'var(--m3-on-surface-variant)' } }, posDef.desc)));
          body.appendChild(h('div', { class: 'tj-ss-isec' }, h('div', { class: 'tj-ss-ilabel' }, 'Role in diagram'), kv));
          body.appendChild(h('div', { class: 'tj-ss-isec' }, h('div', { class: 'tj-ss-ilabel' }, 'Change part of speech'), posGrid));
        }
      } else {
        const outline = h('div', { class: 'tj-ss-outline' });
        (st.parse.clausesMeta || [{ id: 'c1', label: 'Main clause', depth: 0 }]).forEach((clause) => {
          outline.appendChild(h('div', { class: 'tj-ss-orow', style: { 'padding-left': (clause.depth * 14 + 10) + 'px', 'font-weight': '600' } }, h('span', { class: 'marker' }), h('span', { style: { color: 'var(--m3-on-surface-variant)', 'font-size': '11px', 'text-transform': 'uppercase', 'letter-spacing': '.5px' } }, clause.label)));
          toks.filter((t) => t.clause === clause.id).forEach((t) => {
            outline.appendChild(h('div', { class: 'tj-ss-orow', style: { 'padding-left': ((Math.min(3, clause.depth + 1)) * 16 + 10) + 'px', background: selected === t.i ? 'var(--m3-secondary-container)' : null }, onclick: () => setSelected(t.i) }, h('span', { class: 'role' }, t.pos), h('span', {}, t.word), h('span', { style: { 'margin-left': 'auto', color: 'var(--m3-on-surface-variant)', 'font-size': '11px' } }, ROLE_LABELS[t.role] || '')));
          });
        });
        body.appendChild(outline);
      }
      return h('aside', { class: 'tj-ss-inspector' }, tabs, body);
    }

    function buildWorkspace() {
      const canvasInner = h('div', { style: { 'transform-origin': 'top center' } });
      // CSS `zoom` (not transform:scale) so the layout box reflows for scrollbars
      // — a Chromium property; TheJournal runs on Chromium (Electron + Chrome/Edge web).
      canvasInner.style.zoom = String(st.zoom);
      canvasInnerRef = canvasInner;
      canvasInner.appendChild(renderDiagram(diagramCtx()));
      const canvasWrap = h('div', { class: 'tj-ss-canvaswrap' }, buildCanvasToolbar());
      if (editMode) canvasWrap.appendChild(buildPalette());
      canvasWrap.appendChild(h('div', { class: 'tj-ss-canvas' }, canvasInner));
      if (toast) {
        const tEl = h('div', { class: 'tj-ss-toast' + (toast.error ? ' error' : '') });
        if (toast.parsing) { tEl.appendChild(h('span', { class: 'tj-ss-spin' })); tEl.appendChild(document.createTextNode('Parsing the sentence…')); }
        else if (toast.error) { tEl.appendChild(icon('auto_awesome', 16)); tEl.appendChild(document.createTextNode(' Parser error: ' + toast.error)); }
        else if (toast.info) { tEl.appendChild(icon('auto_awesome', 16)); tEl.appendChild(document.createTextNode(' ' + toast.info)); }
        canvasWrap.appendChild(tEl);
      }
      return h('div', { class: 'tj-ss-body' }, canvasWrap, buildInspector());
    }

    function buildLessons() {
      const cur = LESSONS.find((l) => l.id === lessonActive) || LESSONS[0];
      const completed = LESSONS.filter((l) => l.status === 'done').length; const pct = completed / LESSONS.length;
      const list = h('div', { class: 'tj-ss-llist' }, h('div', { class: 'tj-ss-ltitle' }, 'Diagramming Path'),
        LESSONS.map((l) => h('div', { class: 'tj-ss-lcard' + (lessonActive === l.id ? ' active' : ''), onclick: () => { lessonActive = l.id; render(); } },
          h('div', { class: 'stripe', style: { background: l.swatch } }),
          h('div', { class: 'lct' }, h('div', { class: 't' }, `Lesson ${l.id} · ${l.title}`), h('div', { class: 'sub' }, l.sub)),
          l.status === 'done' ? h('span', { class: 'tj-ss-pill' }, 'DONE') : l.status === 'current' ? h('span', { class: 'tj-ss-pill now' }, 'NOW') : h('span', { class: 'tj-ss-pill locked' }, 'LOCKED'),
        )));
      const ring = s('svg', { viewBox: '0 0 36 36', width: 68, height: 68 });
      ring.appendChild(s('circle', { cx: 18, cy: 18, r: 15.9, fill: 'none', stroke: 'var(--m3-surface-container-high)', 'stroke-width': 3.2 }));
      ring.appendChild(s('circle', { cx: 18, cy: 18, r: 15.9, fill: 'none', stroke: 'var(--m3-primary)', 'stroke-width': 3.2, 'stroke-dasharray': `${pct * 100} 100`, 'stroke-linecap': 'round', transform: 'rotate(-90 18 18)' }));
      ring.appendChild(s('text', { x: 18, y: 22, 'text-anchor': 'middle', fill: 'var(--m3-on-surface)', 'font-size': 10, 'font-weight': 700 }, Math.round(pct * 100) + '%'));
      const steps = [
        ['Watch the example', 'See "the quick brown fox jumps" diagrammed step-by-step. Notice how "the", "quick", and "brown" all slant under "fox".'],
        ['Try it yourself', 'Type your own sentence with two or more modifiers and watch the auto-draft place them.'],
        ['Check your work', 'Tap any modifier and confirm its target. Use Suggest if you’re stuck.'],
        ['Mini quiz', '5 short sentences — drag the right modifier onto the right slot.'],
      ];
      const detail = h('div', { class: 'tj-ss-ldetail' },
        h('div', { class: 'tj-ss-crumb' }, 'Lesson ' + cur.id), h('h1', {}, cur.title),
        h('div', { class: 'tj-ss-intro' }, cur.sub + ' — In this lesson you’ll learn how to identify modifiers and place them on slanted lines under the words they describe.'),
        h('div', { class: 'tj-ss-pcard' }, ring, h('div', {}, h('div', { style: { 'font-size': '11px', color: 'var(--m3-on-surface-variant)', 'text-transform': 'uppercase', 'letter-spacing': '.3px', 'font-weight': '600' } }, 'Your Progress'), h('div', { style: { 'font-size': '22px', 'font-weight': '700' } }, `${completed} of ${LESSONS.length} lessons complete`)), h('div', { class: 'tj-ss-pbar' }, h('div', { style: { width: (pct * 100) + '%' } }))),
        steps.map((sp, i) => h('div', { class: 'tj-ss-step' }, h('div', { class: 'tj-ss-stepnum' }, String(i + 1)), h('div', {}, h('div', { style: { 'font-weight': '600', 'margin-bottom': '4px', 'font-size': '15px' } }, sp[0]), h('p', { style: { color: 'var(--m3-on-surface-variant)' } }, sp[1])))),
        h('div', { style: { display: 'flex', gap: '8px', 'margin-top': '24px' } }, h('button', { class: 'tj-ss-btn' }, icon('play_arrow', 18), 'Start lesson'), h('button', { class: 'tj-ss-btn ghost' }, 'Skip for now')),
      );
      return h('div', { class: 'tj-ss-lessons' }, list, detail);
    }

    function buildLibrary() {
      return h('div', { class: 'tj-ss-library' },
        h('h1', { style: { 'font-size': '32px', 'font-weight': '700', margin: '0 0 8px', 'letter-spacing': '-.5px' } }, 'Library'),
        h('p', { style: { color: 'var(--m3-on-surface-variant)', 'font-size': '15px', 'margin-bottom': '24px' } }, 'Example sentences to study or use as a starting point.'),
        h('div', { class: 'tj-ss-libgrid' }, LIBRARY.map((ex) => h('div', { class: 'tj-ss-libcard' },
          h('div', { style: { 'font-size': '11px', 'font-weight': '600', color: 'var(--m3-primary)', 'text-transform': 'uppercase', 'letter-spacing': '.5px', 'margin-bottom': '6px' } }, ex.tag),
          h('div', { style: { 'font-size': '15px', 'line-height': '22px' } }, ex.sentence),
          h('button', { class: 'tj-ss-btn ghost', style: { 'margin-top': '12px', padding: '5px 12px' }, onclick: () => { tab = 'workspace'; reparse(ex.sentence.replace(/[…]/g, '')); } }, icon('open_in_new', 14), 'Open'),
        ))),
      );
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(buildTopBar());
      if (tab === 'workspace') { root.appendChild(buildStrip()); root.appendChild(buildWorkspace()); }
      else if (tab === 'lessons') { root.appendChild(h('div', {})); root.appendChild(buildLessons()); }
      else { root.appendChild(h('div', {})); root.appendChild(buildLibrary()); }
    }

    function exportSvg() {
      const svgStr = renderPreviewSvg(st);
      try {
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sentence-diagram.svg'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch {}
    }

    render();
    return { close, get state() { return st; } };
  }

  // ── TipTap node + toolbar button ─────────────────────────────────────────────
  const parseJson = (s2) => { try { return JSON.parse(s2); } catch { return null; } };
  function parseSvgNode(svgStr) {
    if (!svgStr) return null;
    try { const tmp = document.createElement('div'); tmp.innerHTML = String(svgStr); return tmp.querySelector('svg') || null; } catch { return null; }
  }

  API.registerTiptapExtension({
    name: 'sentenceDiagram',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        state: {
          default: null,
          parseHTML: (el) => parseJson(el.getAttribute('data-state')),
          renderHTML: (attrs) => (attrs.state ? { 'data-state': JSON.stringify(attrs.state) } : {}),
        },
        previewSvg: {
          default: '',
          parseHTML: (el) => { const inline = el.querySelector('svg'); return inline ? inline.outerHTML : (el.getAttribute('data-preview') || ''); },
          renderHTML: () => ({}),
        },
      };
    },
    parseHTML() { return [{ tag: 'div[data-type="sentence-diagram"]' }]; },
    renderHTML({ node, HTMLAttributes }) {
      const attrs = Object.assign({}, HTMLAttributes, { 'data-type': 'sentence-diagram' });
      const svgNode = parseSvgNode(node && node.attrs && node.attrs.previewSvg);
      return svgNode ? ['div', attrs, svgNode] : ['div', attrs];
    },
    addNodeView() {
      return ({ node, view, getPos }) => {
        let currentNode = node;
        const dom = document.createElement('div');
        dom.className = 'tj-sentence-diagram';
        dom.style.cssText = 'border:1px solid var(--color-border-primary,#374151);border-radius:8px;margin:12px 0;padding:10px;background:var(--color-bg-card,rgba(255,255,255,.03));color:var(--color-text-primary,currentColor)';
        const updateAttrs = (next) => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, Object.assign({}, currentNode.attrs, next)));
        };
        const render = () => {
          dom.innerHTML = '';
          const st = currentNode.attrs.state;
          const titleText = st && typeof st.sentence === 'string' && st.sentence ? st.sentence : 'Sentence diagram';
          const bar = h('div', { style: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '6px', gap: '8px' } },
            h('span', { style: { font: '13px ' + FONT, opacity: '.85', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' } }, titleText),
            h('button', { type: 'button', style: { padding: '5px 10px', border: '1px solid var(--color-border-primary,#374151)', 'border-radius': '6px', background: 'transparent', color: 'inherit', cursor: 'pointer', 'font-size': '12px', 'flex-shrink': '0' }, onclick: (e) => { e.preventDefault(); e.stopPropagation(); openStudio(currentNode.attrs.state, (r) => updateAttrs(r)); } }, currentNode.attrs.previewSvg ? 'Edit diagram' : 'Build diagram'),
          );
          dom.appendChild(bar);
          const viewBox = h('div', { style: { 'min-height': '80px', color: 'var(--color-text-primary,currentColor)' } });
          if (currentNode.attrs.previewSvg) viewBox.innerHTML = currentNode.attrs.previewSvg;
          else { viewBox.style.cssText += ';display:flex;align-items:center;justify-content:center;opacity:.5;font-size:13px;min-height:120px'; viewBox.textContent = 'Click "Build diagram" to start.'; }
          dom.appendChild(viewBox);
        };
        render();
        return { dom, update(updated) { if (updated.type.name !== 'sentenceDiagram') return false; currentNode = updated; render(); return true; } };
      };
    },
  });

  if (typeof API.registerToolbarButton === 'function') {
    API.registerToolbarButton({
      id: 'sentence-diagrammer',
      label: 'Sentence',
      title: 'Insert sentence diagram (Sentence Studio)',
      icon: 'network',
      onClick(editor) { editor.chain().focus().insertContent({ type: 'sentenceDiagram', attrs: { state: null, previewSvg: '' } }).run(); },
    });
  }

  // Debug/test surface for the pure engine.
  try {
    window.__sentenceStudio = { parseSentence, heuristicParse, defaultParse, analyze, tagWord, renderPreviewSvg, normalizeState, emptyState, openStudio, POS_DEFS, POS_LOOKUP, tokensFromParse };
  } catch { /* non-browser */ }
})();
