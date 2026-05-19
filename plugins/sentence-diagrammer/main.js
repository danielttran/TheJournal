(function () {
  const emptyPart = () => ({ word: '', modifiers: [] });
  const defaultTree = () => ({ subject: emptyPart(), verb: emptyPart(), directObject: emptyPart() });
  const clone = value => JSON.parse(JSON.stringify(value || {}));
  const normalizeTree = tree => {
    const next = { ...defaultTree(), ...clone(tree) };
    for (const key of ['subject', 'verb', 'directObject']) {
      next[key] = { ...emptyPart(), ...(next[key] || {}) };
      next[key].modifiers = Array.isArray(next[key].modifiers) ? next[key].modifiers : [];
    }
    return next;
  };
  const parseJsonAttr = value => {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  };
  const tokenize = text => text.trim().split(/\s+/).filter(Boolean);
  const labelFor = key => ({ subject: 'Subject', verb: 'Predicate', directObject: 'Direct Object' })[key] || key;

  function createMeasure(root) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.opacity = '0';
    svg.style.pointerEvents = 'none';
    const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textNode.setAttribute('font-family', 'Georgia, serif');
    textNode.setAttribute('font-size', '18');
    svg.appendChild(textNode);
    root.appendChild(svg);
    const measure = text => {
      textNode.textContent = text || '';
      try {
        return Math.max(24, textNode.getComputedTextLength() + 12);
      } catch {
        return Math.max(24, String(text || '').length * 9 + 12);
      }
    };
    measure.destroy = () => svg.remove();
    return measure;
  }

  function buildLayout(tree, measure) {
    const parts = ['subject', 'verb', 'directObject'];
    const baselineY = 78;
    const paddingX = 26;
    const gap = 36;
    const textY = baselineY - 10;
    let cursor = paddingX;
    const slots = {};

    for (const key of parts) {
      const part = tree[key] || emptyPart();
      const wordWidth = measure(part.word || labelFor(key));
      const width = Math.max(96, wordWidth);
      slots[key] = {
        key,
        x: cursor,
        y: baselineY,
        textY,
        width,
        center: cursor + width / 2,
        word: part.word,
        modifiers: part.modifiers || [],
      };
      cursor += width + gap;
    }

    const endX = cursor - gap;
    const maxModifiers = Math.max(...parts.map(key => slots[key].modifiers.length), 0);
    const height = baselineY + 72 + maxModifiers * 34;
    return { slots, baselineY, paddingX, endX, width: endX + paddingX, height };
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
    return el;
  }

  function renderSvg(root, attrs, options) {
    const tree = normalizeTree(attrs.diagramTree);
    const measure = createMeasure(root);
    const layout = buildLayout(tree, measure);
    const svg = svgEl('svg', {
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': attrs.rawText ? `Sentence diagram: ${attrs.rawText}` : 'Blank sentence diagram',
    });
    svg.style.display = 'block';
    svg.style.minHeight = '220px';

    const style = svgEl('style');
    style.textContent = `
      .sd-line { stroke: currentColor; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .sd-word { fill: currentColor; font: 18px Georgia, serif; }
      .sd-label { fill: currentColor; opacity: .45; font: 12px system-ui, sans-serif; }
      .sd-drop { fill: #60a5fa; opacity: .08; stroke: #60a5fa; stroke-width: 1.5; stroke-dasharray: 4 4; }
      .sd-drop-active { opacity: .2; }
    `;
    svg.appendChild(style);
    svg.appendChild(svgEl('line', { class: 'sd-line', x1: layout.paddingX, y1: layout.baselineY, x2: layout.endX, y2: layout.baselineY }));

    const subjectEnd = layout.slots.subject.x + layout.slots.subject.width + 18;
    const verbEnd = layout.slots.verb.x + layout.slots.verb.width + 18;
    svg.appendChild(svgEl('line', { class: 'sd-line', x1: subjectEnd, y1: layout.baselineY - 42, x2: subjectEnd, y2: layout.baselineY + 34 }));
    svg.appendChild(svgEl('line', { class: 'sd-line', x1: verbEnd, y1: layout.baselineY, x2: verbEnd, y2: layout.baselineY - 42 }));

    for (const key of ['subject', 'verb', 'directObject']) {
      const slot = layout.slots[key];
      const label = svgEl('text', { class: 'sd-label', x: slot.x, y: layout.baselineY - 34 });
      label.textContent = labelFor(key);
      svg.appendChild(label);

      const text = svgEl('text', { class: 'sd-word', x: slot.x + 6, y: slot.textY });
      text.textContent = slot.word || (options.editing ? 'Drop word' : '');
      svg.appendChild(text);

      if (options.editing) {
        const baseDrop = svgEl('rect', {
          class: 'sd-drop',
          x: slot.x,
          y: layout.baselineY - 58,
          width: slot.width,
          height: 50,
          rx: 4,
          'data-drop-kind': 'base',
          'data-slot': key,
        });
        svg.appendChild(baseDrop);
      }

      slot.modifiers.forEach((modifier, index) => {
        const startX = slot.x + 12 + index * 34;
        const startY = layout.baselineY + 2;
        const length = Math.max(58, measure(modifier));
        const endX = startX + Math.min(76, length);
        const endY = startY + Math.min(76, length);
        svg.appendChild(svgEl('line', { class: 'sd-line', x1: startX, y1: startY, x2: endX, y2: endY }));
        const modText = svgEl('text', {
          class: 'sd-word',
          x: startX + 10,
          y: startY + 20,
          transform: `rotate(45 ${startX + 10} ${startY + 20})`,
        });
        modText.textContent = modifier;
        svg.appendChild(modText);
      });

      if (options.editing && slot.word) {
        const modifierDrop = svgEl('rect', {
          class: 'sd-drop',
          x: slot.x,
          y: layout.baselineY + 12,
          width: slot.width,
          height: 56,
          rx: 4,
          'data-drop-kind': 'modifier',
          'data-slot': key,
        });
        svg.appendChild(modifierDrop);
      }
    }

    measure.destroy();
    root.appendChild(svg);
    root.querySelectorAll('[data-drop-kind]').forEach(zone => {
      zone.addEventListener('dragover', event => {
        event.preventDefault();
        zone.classList.add('sd-drop-active');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('sd-drop-active'));
      zone.addEventListener('drop', event => {
        event.preventDefault();
        zone.classList.remove('sd-drop-active');
        options.onDrop(zone.getAttribute('data-slot'), zone.getAttribute('data-drop-kind'), event.dataTransfer.getData('text/plain'));
      });
    });
  }

  window.TheJournalAPI.registerTiptapExtension({
    name: 'sentenceDiagram',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        rawText: { default: '', parseHTML: el => el.getAttribute('data-raw-text') || '', renderHTML: attrs => ({ 'data-raw-text': attrs.rawText || '' }) },
        tokens: { default: [], parseHTML: el => parseJsonAttr(el.getAttribute('data-tokens')) || [], renderHTML: attrs => ({ 'data-tokens': JSON.stringify(attrs.tokens || []) }) },
        diagramTree: { default: defaultTree(), parseHTML: el => parseJsonAttr(el.getAttribute('data-diagram-tree')) || defaultTree(), renderHTML: attrs => ({ 'data-diagram-tree': JSON.stringify(attrs.diagramTree || defaultTree()) }) },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="sentence-diagram"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', { ...HTMLAttributes, 'data-type': 'sentence-diagram' }];
    },
    addNodeView() {
      return ({ node, view, getPos }) => {
        let currentNode = node;
        let isEditing = !(node.attrs.rawText || '').trim();
        const dom = document.createElement('div');
        dom.className = 'tj-sentence-diagram';
        dom.style.border = '1px solid var(--color-border-primary, #374151)';
        dom.style.borderRadius = '8px';
        dom.style.margin = '12px 0';
        dom.style.padding = '12px';
        dom.style.background = 'var(--color-bg-card, rgba(255,255,255,.03))';
        dom.style.color = 'var(--color-text-primary, currentColor)';

        const updateAttrs = next => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos === null || pos === undefined) return;
          const attrs = { ...currentNode.attrs, ...next };
          const tr = view.state.tr.setNodeMarkup(pos, undefined, attrs);
          view.dispatch(tr);
        };

        const render = () => {
          dom.innerHTML = '';
          const attrs = currentNode.attrs;

          if (isEditing) {
            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.gap = '8px';
            controls.style.alignItems = 'center';
            controls.style.marginBottom = '10px';

            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Enter a sentence to diagram...';
            input.value = attrs.rawText || '';
            input.style.flex = '1';
            input.style.padding = '8px 10px';
            input.style.border = '1px solid var(--color-border-primary, #374151)';
            input.style.borderRadius = '6px';
            input.style.background = 'var(--color-bg-sidebar, transparent)';
            input.style.color = 'inherit';
            input.addEventListener('keydown', event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const rawText = input.value.trim();
              updateAttrs({ rawText, tokens: tokenize(rawText), diagramTree: defaultTree() });
            });
            controls.appendChild(input);

            const done = document.createElement('button');
            done.type = 'button';
            done.textContent = 'Done';
            done.style.padding = '7px 10px';
            done.style.borderRadius = '6px';
            done.style.border = '1px solid var(--color-border-primary, #374151)';
            done.style.background = 'transparent';
            done.style.color = 'inherit';
            done.addEventListener('click', () => { isEditing = false; render(); });
            controls.appendChild(done);
            dom.appendChild(controls);

            const tokenRow = document.createElement('div');
            tokenRow.style.display = 'flex';
            tokenRow.style.flexWrap = 'wrap';
            tokenRow.style.gap = '6px';
            tokenRow.style.minHeight = '28px';
            tokenRow.style.marginBottom = '10px';
            (attrs.tokens || []).forEach((token, index) => {
              const chip = document.createElement('span');
              chip.textContent = token;
              chip.draggable = true;
              chip.style.padding = '4px 8px';
              chip.style.borderRadius = '999px';
              chip.style.border = '1px solid var(--color-border-primary, #374151)';
              chip.style.cursor = 'grab';
              chip.style.userSelect = 'none';
              chip.addEventListener('dragstart', event => {
                event.dataTransfer.setData('text/plain', String(index));
                event.dataTransfer.effectAllowed = 'move';
              });
              tokenRow.appendChild(chip);
            });
            dom.appendChild(tokenRow);
          }

          renderSvg(dom, attrs, {
            editing: isEditing,
            onDrop: (slot, kind, tokenIndexText) => {
              const tokenIndex = Number(tokenIndexText);
              const tokens = [...(currentNode.attrs.tokens || [])];
              const token = tokens[tokenIndex];
              if (!slot || !kind || !token) return;
              tokens.splice(tokenIndex, 1);
              const diagramTree = normalizeTree(currentNode.attrs.diagramTree);
              if (kind === 'modifier' && diagramTree[slot].word) diagramTree[slot].modifiers.push(token);
              else diagramTree[slot].word = token;
              updateAttrs({ tokens, diagramTree });
            },
          });
        };

        const outsideHandler = event => {
          if (!dom.contains(event.target) && isEditing) {
            isEditing = false;
            render();
          }
        };
        dom.addEventListener('click', () => {
          if (!isEditing) {
            isEditing = true;
            render();
          }
        });
        document.addEventListener('mousedown', outsideHandler);
        render();

        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type.name !== 'sentenceDiagram') return false;
            currentNode = updatedNode;
            render();
            return true;
          },
          destroy() {
            document.removeEventListener('mousedown', outsideHandler);
          },
        };
      };
    },
  });

  if (typeof window.TheJournalAPI.registerToolbarButton === 'function') {
    window.TheJournalAPI.registerToolbarButton({
      id: 'sentence-diagrammer',
      label: 'Diagram',
      title: 'Insert sentence diagram',
      icon: 'network',
      onClick(editor) {
        editor.chain().focus().insertContent({
          type: 'sentenceDiagram',
          attrs: { rawText: '', tokens: [], diagramTree: defaultTree() },
        }).run();
      },
    });
  }
})();
