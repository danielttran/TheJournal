(function () {
  // LexiGraph — interactive Reed-Kellogg sentence diagrammer.
  // Implements the design in docs: a magnetic-line canvas where word chips from
  // a tokenized word bank snap (perpendicular projection) onto lines. Pure
  // vanilla JS + SVG (plugins run via new Function — no bundler/imports).
  //
  // Node storage: attrs.state = normalized model { canvas, sentence, nodes };
  // attrs.previewSvg = static SVG rendered for inline display in the entry.

  const NS = 'http://www.w3.org/2000/svg';
  const SNAP_RADIUS = 30;
  const TOKEN_MIME = 'application/x-tj-lexigraph-token';

  const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
  const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 8);
  const rad = (deg) => (deg * Math.PI) / 180;

  function emptyState() {
    return {
      canvas: { zoom: 1, panX: 0, panY: 0 },
      sentence: { rawText: '', tokens: [] },
      nodes: {},
    };
  }

  function normalizeState(raw) {
    const s = (raw && typeof raw === 'object') ? clone(raw) : emptyState();
    if (!s.canvas) s.canvas = { zoom: 1, panX: 0, panY: 0 };
    if (!s.sentence) s.sentence = { rawText: '', tokens: [] };
    if (!Array.isArray(s.sentence.tokens)) s.sentence.tokens = [];
    if (!s.nodes || typeof s.nodes !== 'object') s.nodes = {};
    for (const id of Object.keys(s.nodes)) {
      const n = s.nodes[id];
      n.id = id;
      n.slots = Array.isArray(n.slots) ? n.slots : [];
      n.dividers = Array.isArray(n.dividers) ? n.dividers : [];
      n.angle = Number(n.angle) || 0;
      n.length = Number(n.length) || 120;
      n.startX = Number(n.startX) || 0;
      n.startY = Number(n.startY) || 0;
    }
    return s;
  }

  function wordList(text) {
    return String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
  }
  function tokenize(text) {
    return wordList(text).map((w) => ({ id: uid('t'), text: w, used: false }));
  }

  function tokenById(state, id) {
    return state.sentence.tokens.find((t) => t.id === id) || null;
  }
  function slotText(state, slot) {
    const t = tokenById(state, slot.tokenId);
    return t ? t.text : '';
  }

  // Re-tokenize while preserving already-placed words: re-use existing tokens
  // whose text still appears (keeping their id so slots stay valid), mint new
  // ids for new words, prune slots whose token vanished, and recompute `used`.
  function reconcileTokens(state, raw) {
    raw = String(raw || '').trim();
    const old = state.sentence.tokens.slice();
    const claimed = new Array(old.length).fill(false);
    const tokens = wordList(raw).map((w) => {
      const idx = old.findIndex((o, i) => !claimed[i] && o.text === w);
      if (idx >= 0) { claimed[idx] = true; return old[idx]; }
      return { id: uid('t'), text: w, used: false };
    });
    state.sentence.rawText = raw;
    state.sentence.tokens = tokens;
    const liveIds = new Set(tokens.map((t) => t.id));
    for (const id of Object.keys(state.nodes)) {
      state.nodes[id].slots = state.nodes[id].slots.filter((s) => liveIds.has(s.tokenId));
    }
    const placed = new Set();
    for (const id of Object.keys(state.nodes)) state.nodes[id].slots.forEach((s) => placed.add(s.tokenId));
    tokens.forEach((t) => { t.used = placed.has(t.id); });
    return state;
  }

  // ── geometry ────────────────────────────────────────────────────────────────
  function lineEnds(n) {
    const a = rad(n.angle || 0);
    return {
      ax: n.startX, ay: n.startY,
      bx: n.startX + (n.length || 0) * Math.cos(a),
      by: n.startY + (n.length || 0) * Math.sin(a),
    };
  }
  function projectToLine(px, py, n) {
    const { ax, ay, bx, by } = lineEnds(n);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    return { t, x, y, dist: Math.hypot(px - x, py - y) };
  }
  function nearestLine(state, px, py) {
    let best = null;
    for (const id of Object.keys(state.nodes)) {
      const p = projectToLine(px, py, state.nodes[id]);
      if (!best || p.dist < best.dist) best = { id, ...p };
    }
    return best;
  }

  // ── text measuring (shared hidden SVG) ───────────────────────────────────────
  function makeMeasurer() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('font-family', 'Georgia, serif');
    t.setAttribute('font-size', '17');
    svg.appendChild(t);
    document.body.appendChild(svg);
    const fn = (text) => {
      t.textContent = text || '';
      let w; try { w = t.getComputedTextLength(); } catch { w = String(text || '').length * 9; }
      return Math.max(20, w);
    };
    fn.destroy = () => svg.remove();
    return fn;
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS(NS, name);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, String(attrs[k]));
    return el;
  }

  // Auto-grow a line so its assigned words don't overlap.
  function autosizeLine(state, n, measure) {
    if (!n.slots.length) return;
    const total = n.slots.reduce((sum, s) => sum + measure(slotText(state, s) || '') + 24, 40);
    if (total > n.length) n.length = total;
  }

  // ── render the diagram (shared by editor canvas + static preview) ────────────
  // mode: 'edit' attaches data-* hooks; 'preview' is static. Returns the <g> root.
  function renderDiagram(state, measure, opts) {
    opts = opts || {};
    const g = svgEl('g', {});
    const labelColor = opts.color || 'currentColor';

    for (const id of Object.keys(state.nodes)) {
      const n = state.nodes[id];
      const { ax, ay, bx, by } = lineEnds(n);
      const ng = svgEl('g', { 'data-node': id });
      // the line
      const line = svgEl('line', {
        x1: ax, y1: ay, x2: bx, y2: by,
        stroke: labelColor, 'stroke-width': n.type === 'PEDESTAL' ? 2.5 : 2,
        'stroke-dasharray': n.type === 'FORK_LINK' ? '5 4' : '',
        'vector-effect': 'non-scaling-stroke',
        'data-line': id,
        style: opts.mode === 'edit' ? 'cursor:move' : '',
      });
      if (opts.selectedId === id) { line.setAttribute('stroke', '#14b8a6'); line.setAttribute('stroke-width', '3'); }
      ng.appendChild(line);

      // dividers (vertical bars crossing the baseline)
      (n.dividers || []).forEach((d) => {
        const t = d.position == null ? 0.5 : d.position;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        const h = d.height || 40;
        ng.appendChild(svgEl('line', { x1: x, y1: y - h / 2, x2: x, y2: y + (d.full ? h / 2 : 0), stroke: labelColor, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
      });

      // words in slots
      (n.slots || []).forEach((slot, slotIdx) => {
        const t = slot.position == null ? 0.5 : slot.position;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        const txt = slotText(state, slot);
        const angle = n.angle || 0;
        const isFlat = Math.abs(angle) < 1;
        const attrs = {
          x: isFlat ? x - measure(txt) / 2 : x + 6,
          y: isFlat ? y - 8 : y + 18,
          fill: labelColor, 'font-family': 'Georgia, serif', 'font-size': '17',
          transform: isFlat ? '' : `rotate(${angle} ${x} ${y})`,
        };
        if (opts.mode === 'edit') {
          attrs['data-slot-line'] = id;
          attrs['data-slot-idx'] = slotIdx;
          attrs.style = 'cursor:grab';
        }
        const tx = svgEl('text', attrs);
        tx.textContent = txt;
        ng.appendChild(tx);
      });

      g.appendChild(ng);
    }
    return g;
  }

  // bounding box of all geometry, for preview sizing
  function diagramBounds(state) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of Object.keys(state.nodes)) {
      const { ax, ay, bx, by } = lineEnds(state.nodes[id]);
      minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by); maxY = Math.max(maxY, ay, by);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 400, maxY: 200 };
    return { minX, minY, maxX, maxY };
  }

  function renderPreviewSvg(state) {
    const measure = makeMeasurer();
    const b = diagramBounds(state);
    const pad = 50;
    const w = Math.max(120, b.maxX - b.minX + pad * 2);
    const h = Math.max(80, b.maxY - b.minY + pad * 2);
    const svg = svgEl('svg', { xmlns: NS, viewBox: `${b.minX - pad} ${b.minY - pad} ${w} ${h}`, width: '100%', height: 'auto', preserveAspectRatio: 'xMidYMid meet' });
    svg.style.maxHeight = '420px';
    const g = renderDiagram(state, measure, { mode: 'preview', color: 'currentColor' });
    svg.appendChild(g);
    measure.destroy();
    const empty = Object.keys(state.nodes).length === 0;
    if (empty) {
      const t = svgEl('text', { x: b.minX, y: b.minY + 20, fill: 'currentColor', 'font-size': '14', opacity: '0.5' });
      t.textContent = 'Empty sentence diagram';
      svg.appendChild(t);
    }
    return svg.outerHTML;
  }

  // ── overlay editor ────────────────────────────────────────────────────────────
  function openEditor(initialState, onSave) {
    if (window.__tjLexigraphOpen) return; // reentrancy guard — no stacked editors
    window.__tjLexigraphOpen = true;
    let state = normalizeState(initialState);
    const measure = makeMeasurer();

    const history = [clone(state)];
    let histIndex = 0;
    let selectedId = null;
    let activeTool = null;          // pending tool for next canvas click
    let dragTokenId = null;         // token being dragged from the bank
    let bankFocusIndex = -1;        // keyboard Tab selection in the bank
    let panning = null;             // {x,y,panX,panY}
    let movingNode = null;          // {id, dx, dy}
    let movingSlot = null;          // {lineId, idx} — a placed word being repositioned

    const pushHistory = () => {
      history.splice(histIndex + 1);
      history.push(clone(state));
      histIndex = history.length - 1;
    };
    const undo = () => { if (histIndex > 0) { histIndex--; state = clone(history[histIndex]); selectedId = null; renderAll(); } };
    const redo = () => { if (histIndex < history.length - 1) { histIndex++; state = clone(history[histIndex]); selectedId = null; renderAll(); } };

    // ----- overlay shell -----
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const shell = document.createElement('div');
    shell.style.cssText = 'width:100vw;height:100vh;background:var(--color-bg-card,#0b0f17);color:var(--color-text-primary,#e5e7eb);border:0;border-radius:0;display:flex;flex-direction:column;overflow:hidden';
    overlay.appendChild(shell);

    // top dock
    const dock = document.createElement('div');
    dock.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--color-border-primary,#374151);display:flex;flex-direction:column;gap:8px';
    const dockRow = document.createElement('div');
    dockRow.style.cssText = 'display:flex;gap:8px;align-items:center';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type a sentence, e.g. The local employees arrive before ten.';
    input.value = state.sentence.rawText || '';
    input.style.cssText = 'flex:1;padding:8px 10px;border:1px solid var(--color-border-primary,#374151);border-radius:6px;background:var(--color-bg-sidebar,#111827);color:inherit;font-size:14px';
    const tokenizeBtn = btn('Tokenize', () => { applyTokenize(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyTokenize(input.value); } });
    dockRow.appendChild(input);
    dockRow.appendChild(tokenizeBtn);
    dock.appendChild(dockRow);
    const bank = document.createElement('div');
    bank.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;min-height:30px';
    dock.appendChild(bank);
    shell.appendChild(dock);

    // body: left toolbar | canvas | right inspector
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;min-height:0';
    shell.appendChild(body);

    const leftBar = document.createElement('div');
    leftBar.style.cssText = 'width:150px;border-right:1px solid var(--color-border-primary,#374151);padding:8px;display:flex;flex-direction:column;gap:6px;overflow-y:auto';
    const TT = 'stroke="currentColor" stroke-width="1.6" fill="none" vector-effect="non-scaling-stroke"';
    const THUMB = {
      BASELINE: `<svg width="44" height="24" viewBox="0 0 44 24"><line x1="4" y1="13" x2="40" y2="13" ${TT}/><line x1="22" y1="5" x2="22" y2="21" ${TT}/></svg>`,
      MODIFIER: `<svg width="44" height="24" viewBox="0 0 44 24"><line x1="4" y1="7" x2="40" y2="7" ${TT}/><line x1="14" y1="7" x2="26" y2="20" ${TT}/></svg>`,
      VERTICAL: `<svg width="44" height="24" viewBox="0 0 44 24"><line x1="4" y1="13" x2="40" y2="13" ${TT}/><line x1="22" y1="3" x2="22" y2="23" ${TT}/></svg>`,
      PEDESTAL: `<svg width="44" height="24" viewBox="0 0 44 24"><line x1="10" y1="4" x2="34" y2="4" ${TT}/><line x1="22" y1="4" x2="22" y2="22" ${TT}/></svg>`,
      FORK: `<svg width="44" height="24" viewBox="0 0 44 24"><line x1="8" y1="6" x2="38" y2="6" ${TT}/><line x1="8" y1="18" x2="38" y2="18" ${TT}/><line x1="20" y1="6" x2="20" y2="18" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2" fill="none"/></svg>`,
      PREP: `<svg width="44" height="24" viewBox="0 0 44 24"><line x1="6" y1="4" x2="18" y2="18" ${TT}/><line x1="18" y1="18" x2="40" y2="18" ${TT}/></svg>`,
    };
    const tools = [
      ['Baseline (B)', 'BASELINE'], ['Modifier (M)', 'MODIFIER'], ['Vertical (V)', 'VERTICAL'],
      ['Pedestal', 'PEDESTAL'], ['Fork', 'FORK'], ['Prep. Phrase', 'PREP'],
    ];
    const toolButtons = {};
    tools.forEach(([label, type]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--color-border-primary,#374151);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:12px;text-align:left';
      b.innerHTML = `${THUMB[type] || ''}<span>${label}</span>`;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addNodeOfType(type); });
      toolButtons[type] = b;
      leftBar.appendChild(b);
    });
    body.appendChild(leftBar);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;background:repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(127,127,127,.08) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(127,127,127,.08) 24px)';
    const svg = svgEl('svg', { width: '100%', height: '100%' });
    svg.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    canvasWrap.appendChild(svg);
    body.appendChild(canvasWrap);
    const viewport = svgEl('g', {}); // pan/zoom transform group
    svg.appendChild(viewport);
    const ghost = svgEl('g', { opacity: '0.5' }); // snap preview
    svg.appendChild(ghost);

    const rightBar = document.createElement('div');
    rightBar.style.cssText = 'width:210px;border-left:1px solid var(--color-border-primary,#374151);padding:10px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;font-size:13px';
    body.appendChild(rightBar);

    // footer
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:8px 12px;border-top:1px solid var(--color-border-primary,#374151);display:flex;gap:8px;justify-content:flex-end;align-items:center';
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-right:auto;font-size:12px;opacity:.6';
    hint.textContent = 'Drag a word onto a line to attach it · B/M/V add lines · Ctrl+Z undo';
    footer.appendChild(hint);
    footer.appendChild(btn('Undo', undo));
    footer.appendChild(btn('Redo', redo));
    footer.appendChild(btn('Export SVG', exportSvg));
    footer.appendChild(btn('Cancel', close));
    const saveBtn = btn('Save', () => { saveAndClose(); });
    saveBtn.style.background = 'var(--color-accent-primary,#14b8a6)';
    saveBtn.style.color = '#fff';
    saveBtn.style.borderColor = 'transparent';
    footer.appendChild(saveBtn);
    shell.appendChild(footer);

    document.body.appendChild(overlay);
    input.focus();

    // ----- helpers -----
    function btn(label, onClick) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'padding:6px 10px;border:1px solid var(--color-border-primary,#374151);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:13px';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
      return b;
    }

    function applyTokenize(text) {
      reconcileTokens(state, text);
      pushHistory();
      renderAll();
    }

    function clientToCanvas(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      const z = state.canvas.zoom || 1;
      return { x: (clientX - r.left - state.canvas.panX) / z, y: (clientY - r.top - state.canvas.panY) / z };
    }

    function addNodeOfType(type) {
      const center = clientToCanvas(svg.getBoundingClientRect().width / 2, svg.getBoundingClientRect().height / 2);
      const offset = Object.keys(state.nodes).length * 16;
      const id = uid('line');
      const base = { id, type, parentId: null, slots: [], dividers: [], startX: center.x - 120 + offset, startY: center.y + offset };
      if (type === 'BASELINE') { base.angle = 0; base.length = 280; base.dividers = [{ position: 0.5, height: 40, full: true }]; }
      else if (type === 'MODIFIER') { base.angle = 60; base.length = 90; }
      else if (type === 'VERTICAL') { base.angle = 90; base.length = 60; base.startY = center.y - 30 + offset; }
      else if (type === 'PEDESTAL') { base.angle = -90; base.length = 90; }
      else if (type === 'FORK') {
        base.angle = 0; base.length = 200;
        // a parallel partner + dashed link
        const id2 = uid('line');
        state.nodes[id2] = { id: id2, type: 'BASELINE', angle: 0, length: 200, startX: base.startX, startY: base.startY + 60, slots: [], dividers: [] };
        const link = uid('line');
        state.nodes[link] = { id: link, type: 'FORK_LINK', angle: 90, length: 60, startX: base.startX, startY: base.startY, slots: [], dividers: [] };
      } else if (type === 'PREP') {
        base.angle = 55; base.length = 70; // the slant
        const tray = uid('line');
        const e = lineEnds(base);
        state.nodes[tray] = { id: tray, type: 'BASELINE', angle: 0, length: 160, startX: e.bx, startY: e.by, slots: [], dividers: [] };
      }
      state.nodes[id] = base;
      selectedId = id;
      activeTool = null;
      pushHistory();
      renderAll();
    }

    function placeToken(tokenId, lineId, position) {
      const n = state.nodes[lineId];
      const tok = tokenById(state, tokenId);
      if (!n || !tok) return;
      n.slots.push({ position, tokenId, role: roleForType(n.type) });
      tok.used = true;
      autosizeLine(state, n, measure);
      pushHistory();
      renderAll();
    }
    function roleForType(type) {
      return type === 'BASELINE' ? 'SUBJECT' : type === 'MODIFIER' ? 'MODIFIER' : 'WORD';
    }

    function unplaceToken(tokenId) {
      for (const id of Object.keys(state.nodes)) {
        const n = state.nodes[id];
        const before = n.slots.length;
        n.slots = n.slots.filter((s) => s.tokenId !== tokenId);
        if (n.slots.length !== before) {
          const tok = tokenById(state, tokenId); if (tok) tok.used = false;
        }
      }
      pushHistory(); renderAll();
    }

    function exportSvg() {
      const svgStr = renderPreviewSvg(state);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'sentence-diagram.svg';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function saveAndClose() {
      const previewSvg = renderPreviewSvg(state);
      onSave({ state: clone(state), previewSvg });
      close();
    }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      measure.destroy();
      overlay.remove();
      window.__tjLexigraphOpen = false;
    }

    // ----- rendering -----
    function renderBank() {
      bank.innerHTML = '';
      if (!state.sentence.tokens.length) {
        const empty = document.createElement('span');
        empty.textContent = 'Tokenize a sentence to get word chips →';
        empty.style.cssText = 'opacity:.5;font-size:13px';
        bank.appendChild(empty);
        return;
      }
      state.sentence.tokens.forEach((tok, i) => {
        const chip = document.createElement('span');
        chip.textContent = tok.text;
        chip.draggable = !tok.used;
        chip.title = tok.used ? 'Placed (click to unplace)' : 'Drag onto a line';
        const focused = i === bankFocusIndex;
        chip.style.cssText = `padding:4px 9px;border-radius:999px;border:1px solid ${focused ? 'var(--color-accent-primary,#14b8a6)' : 'var(--color-border-primary,#374151)'};cursor:${tok.used ? 'pointer' : 'grab'};user-select:none;font-size:13px;opacity:${tok.used ? '0.3' : '1'}`;
        chip.addEventListener('dragstart', (e) => {
          dragTokenId = tok.id;
          e.dataTransfer.setData(TOKEN_MIME, tok.id);
          e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => { dragTokenId = null; clearGhost(); });
        chip.addEventListener('click', () => { if (tok.used) unplaceToken(tok.id); });
        bank.appendChild(chip);
      });
    }

    function renderCanvas() {
      viewport.setAttribute('transform', `translate(${state.canvas.panX} ${state.canvas.panY}) scale(${state.canvas.zoom})`);
      while (viewport.firstChild) viewport.removeChild(viewport.firstChild);
      const g = renderDiagram(state, measure, { mode: 'edit', selectedId, color: 'currentColor' });
      viewport.appendChild(g);
      // selection / move handlers on each line
      g.querySelectorAll('[data-line]').forEach((lineEl) => {
        const id = lineEl.getAttribute('data-line');
        lineEl.style.cursor = 'move';
        lineEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          selectedId = id; renderInspector(); renderCanvas();
          const p = clientToCanvas(e.clientX, e.clientY);
          movingNode = { id, dx: p.x - state.nodes[id].startX, dy: p.y - state.nodes[id].startY };
          svg.setPointerCapture(e.pointerId);
        });
      });
      // placed words are draggable — re-snap to the nearest line as you move.
      g.querySelectorAll('[data-slot-line]').forEach((wordEl) => {
        wordEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          movingSlot = { lineId: wordEl.getAttribute('data-slot-line'), idx: Number(wordEl.getAttribute('data-slot-idx')) };
          svg.setPointerCapture(e.pointerId);
        });
      });
    }

    function clearGhost() { while (ghost.firstChild) ghost.removeChild(ghost.firstChild); }
    function showGhost(snap, tok) {
      clearGhost();
      if (!snap || snap.dist > SNAP_RADIUS) return;
      const z = state.canvas.zoom || 1;
      const x = snap.x * z + state.canvas.panX, y = snap.y * z + state.canvas.panY;
      const w = measure(tok.text) + 12;
      ghost.appendChild(svgEl('rect', { x: x - w / 2, y: y - 26, width: w, height: 22, rx: 4, fill: '#14b8a6', opacity: '0.15', stroke: '#14b8a6', 'stroke-dasharray': '3 3' }));
      const t = svgEl('text', { x: x - w / 2 + 6, y: y - 10, fill: '#14b8a6', 'font-size': '13', 'font-family': 'Georgia, serif' });
      t.textContent = tok.text; ghost.appendChild(t);
    }

    function renderInspector() {
      rightBar.innerHTML = '';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em;opacity:.7';
      title.textContent = 'Inspector';
      rightBar.appendChild(title);
      if (!selectedId || !state.nodes[selectedId]) {
        const none = document.createElement('div'); none.style.opacity = '.6'; none.textContent = 'Select a line to edit its angle, length, and dividers.';
        rightBar.appendChild(none); return;
      }
      const n = state.nodes[selectedId];
      rightBar.appendChild(field('Type', n.type));
      // angle
      const angleWrap = document.createElement('label'); angleWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
      angleWrap.innerHTML = `<span style="opacity:.7">Angle: <b>${Math.round(n.angle)}°</b></span>`;
      const angle = document.createElement('input'); angle.type = 'range'; angle.min = '-90'; angle.max = '90'; angle.value = String(n.angle);
      angle.addEventListener('input', () => { n.angle = Number(angle.value); renderCanvas(); angleWrap.querySelector('b').textContent = Math.round(n.angle) + '°'; });
      angle.addEventListener('change', pushHistory);
      angleWrap.appendChild(angle); rightBar.appendChild(angleWrap);
      // length
      const lenWrap = document.createElement('label'); lenWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
      lenWrap.innerHTML = '<span style="opacity:.7">Length</span>';
      const len = document.createElement('input'); len.type = 'range'; len.min = '40'; len.max = '500'; len.value = String(n.length);
      len.addEventListener('input', () => { n.length = Number(len.value); renderCanvas(); });
      len.addEventListener('change', pushHistory);
      lenWrap.appendChild(len); rightBar.appendChild(lenWrap);
      // dividers (baselines)
      rightBar.appendChild(btn('Add vertical divider', () => {
        const positions = [0.5, 0.66, 0.33, 0.8];
        const used = (n.dividers || []).map((d) => d.position);
        const pos = positions.find((p) => !used.includes(p)) || 0.5;
        n.dividers.push({ position: pos, height: 40, full: true });
        pushHistory(); renderCanvas();
      }));
      if ((n.dividers || []).length) {
        rightBar.appendChild(btn('Clear dividers', () => { n.dividers = []; pushHistory(); renderCanvas(); }));
      }
      const del = btn('Delete line', () => {
        // free any tokens placed on it
        (n.slots || []).forEach((s) => { const tk = tokenById(state, s.tokenId); if (tk) tk.used = false; });
        delete state.nodes[selectedId]; selectedId = null; pushHistory(); renderAll();
      });
      del.style.color = '#f87171'; del.style.borderColor = '#7f1d1d';
      rightBar.appendChild(del);
    }
    function field(label, value) {
      const d = document.createElement('div'); d.style.cssText = 'display:flex;justify-content:space-between;gap:8px';
      d.innerHTML = `<span style="opacity:.7">${label}</span><b>${value}</b>`; return d;
    }

    function renderAll() { renderBank(); renderCanvas(); renderInspector(); }

    // ----- canvas drag/drop (snap words) -----
    svg.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types || []).includes(TOKEN_MIME)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const p = clientToCanvas(e.clientX, e.clientY);
      const snap = nearestLine(state, p.x, p.y);
      const tok = tokenById(state, dragTokenId);
      if (snap && tok && snap.dist <= SNAP_RADIUS) showGhost(snap, tok); else clearGhost();
    });
    svg.addEventListener('dragleave', clearGhost);
    svg.addEventListener('drop', (e) => {
      if (!Array.from(e.dataTransfer.types || []).includes(TOKEN_MIME)) return;
      e.preventDefault(); clearGhost();
      const tokenId = e.dataTransfer.getData(TOKEN_MIME) || dragTokenId;
      const p = clientToCanvas(e.clientX, e.clientY);
      dragTokenId = null;
      if (!tokenId || !tokenById(state, tokenId)) return;
      let snap = nearestLine(state, p.x, p.y);
      if (snap && snap.dist <= SNAP_RADIUS) {
        placeToken(tokenId, snap.id, snap.t);            // snapped to a nearby line
      } else if (!snap) {
        // No lines yet — drop a baseline where the word landed so it never
        // disappears, then place the word on it.
        const id = uid('line');
        state.nodes[id] = { id, type: 'BASELINE', angle: 0, length: 240, startX: p.x - 120, startY: p.y, slots: [], dividers: [], parentId: null };
        placeToken(tokenId, id, 0.5);
      } else {
        // Lines exist but none are within snap range — attach to the nearest one
        // anyway so the word is never silently lost.
        placeToken(tokenId, snap.id, snap.t);
      }
    });

    // ----- pan + move via pointer -----
    svg.addEventListener('pointerdown', (e) => {
      if (e.target === svg || e.target === viewport) { // empty canvas → pan + deselect
        selectedId = null; renderInspector(); renderCanvas();
        panning = { x: e.clientX, y: e.clientY, panX: state.canvas.panX, panY: state.canvas.panY };
        svg.setPointerCapture(e.pointerId);
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (movingSlot) {
        // re-snap the dragged word to the nearest line and move its slot there
        const p = clientToCanvas(e.clientX, e.clientY);
        const snap = nearestLine(state, p.x, p.y);
        if (!snap) return;
        const from = state.nodes[movingSlot.lineId];
        const slot = from && from.slots[movingSlot.idx];
        if (!slot) { movingSlot = null; return; }
        if (snap.id === movingSlot.lineId) {
          slot.position = snap.t;
        } else {
          from.slots.splice(movingSlot.idx, 1);
          const moved = Object.assign({}, slot, { position: snap.t });
          state.nodes[snap.id].slots.push(moved);
          movingSlot = { lineId: snap.id, idx: state.nodes[snap.id].slots.length - 1 };
        }
        renderCanvas();
      } else if (movingNode) {
        const p = clientToCanvas(e.clientX, e.clientY);
        const n = state.nodes[movingNode.id];
        n.startX = p.x - movingNode.dx; n.startY = p.y - movingNode.dy;
        renderCanvas();
      } else if (panning) {
        state.canvas.panX = panning.panX + (e.clientX - panning.x);
        state.canvas.panY = panning.panY + (e.clientY - panning.y);
        viewport.setAttribute('transform', `translate(${state.canvas.panX} ${state.canvas.panY}) scale(${state.canvas.zoom})`);
      }
    });
    const endPointer = () => {
      if (movingSlot) { movingSlot = null; pushHistory(); }
      if (movingNode) { movingNode = null; pushHistory(); }
      if (panning) panning = null;
    };
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    // zoom with wheel
    canvasWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const z = state.canvas.zoom || 1;
      const nz = Math.max(0.4, Math.min(2.5, z * (e.deltaY < 0 ? 1.1 : 0.9)));
      state.canvas.zoom = nz; renderCanvas();
    }, { passive: false });

    // ----- keyboard -----
    function onKey(e) {
      if (e.target === input) return; // don't hijack typing in the sentence box
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); addNodeOfType('BASELINE'); }
      else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); addNodeOfType('MODIFIER'); }
      else if (e.key === 'v' || e.key === 'V') { e.preventDefault(); addNodeOfType('VERTICAL'); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const open = state.sentence.tokens.map((t, i) => ({ t, i })).filter((x) => !x.t.used);
        if (open.length) {
          const cur = open.findIndex((x) => x.i === bankFocusIndex);
          bankFocusIndex = open[(cur + 1) % open.length].i;
          renderBank();
        }
      } else if (e.key === 'Enter') {
        // auto-snap focused chip to nearest line slot
        const tok = state.sentence.tokens[bankFocusIndex];
        if (tok && !tok.used && Object.keys(state.nodes).length) {
          // place at the start of the first line lacking a slot, else first line
          const ids = Object.keys(state.nodes);
          const target = ids.find((id) => state.nodes[id].type !== 'FORK_LINK') || ids[0];
          placeToken(tok.id, target, 0.5);
          bankFocusIndex = -1;
        }
      } else if (e.key === 'Escape') { close(); }
    }
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    renderAll();
  }

  // ── TipTap node + toolbar button ──────────────────────────────────────────────
  window.TheJournalAPI.registerTiptapExtension({
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
          parseHTML: (el) => el.getAttribute('data-preview') || '',
          renderHTML: (attrs) => (attrs.previewSvg ? { 'data-preview': attrs.previewSvg } : {}),
        },
      };
    },
    parseHTML() { return [{ tag: 'div[data-type="sentence-diagram"]' }]; },
    renderHTML({ HTMLAttributes }) {
      return ['div', Object.assign({}, HTMLAttributes, { 'data-type': 'sentence-diagram' })];
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
          const tr = view.state.tr.setNodeMarkup(pos, undefined, Object.assign({}, currentNode.attrs, next));
          view.dispatch(tr);
        };

        const render = () => {
          dom.innerHTML = '';
          const bar = document.createElement('div');
          bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
          const title = document.createElement('span');
          const st = currentNode.attrs.state;
          title.textContent = st && st.sentence && st.sentence.rawText ? st.sentence.rawText : 'Sentence diagram';
          title.style.cssText = 'font:13px Georgia,serif;opacity:.8';
          const edit = document.createElement('button');
          edit.type = 'button'; edit.textContent = currentNode.attrs.previewSvg ? 'Edit diagram' : 'Build diagram';
          edit.style.cssText = 'padding:5px 10px;border:1px solid var(--color-border-primary,#374151);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:12px';
          edit.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            openEditor(currentNode.attrs.state, (result) => updateAttrs(result));
          });
          bar.appendChild(title); bar.appendChild(edit);
          dom.appendChild(bar);

          const view2 = document.createElement('div');
          view2.style.cssText = 'min-height:80px;color:var(--color-text-primary,currentColor)';
          if (currentNode.attrs.previewSvg) view2.innerHTML = currentNode.attrs.previewSvg;
          else {
            view2.style.cssText += ';display:flex;align-items:center;justify-content:center;opacity:.5;font-size:13px;min-height:120px';
            view2.textContent = 'Click "Build diagram" to start.';
          }
          dom.appendChild(view2);
        };
        render();

        return {
          dom,
          update(updated) {
            if (updated.type.name !== 'sentenceDiagram') return false;
            currentNode = updated; render(); return true;
          },
        };
      };
    },
  });

  if (typeof window.TheJournalAPI.registerToolbarButton === 'function') {
    window.TheJournalAPI.registerToolbarButton({
      id: 'sentence-diagrammer',
      label: 'Sentence',
      title: 'Insert sentence diagram (LexiGraph)',
      icon: 'network',
      onClick(editor) {
        editor.chain().focus().insertContent({ type: 'sentenceDiagram', attrs: { state: null, previewSvg: '' } }).run();
      },
    });
  }

  // Debug/test surface for the pure engine (tokenizer + snapping geometry +
  // preview). Lets the magnetic-line math be verified without the full canvas.
  try {
    window.__lexigraph = { tokenize, reconcileTokens, normalizeState, emptyState, lineEnds, projectToLine, nearestLine, renderPreviewSvg, openEditor };
  } catch { /* non-browser */ }
})();
