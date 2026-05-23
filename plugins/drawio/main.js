(function () {
  // ── draw.io embed protocol ──────────────────────────────────────────────────
  // The embedded editor lives at embed.diagrams.net and talks to its parent
  // via window.postMessage. Protocol summary (proto=json):
  //
  //   iframe → parent:  { event: 'init' }                        on ready
  //   parent → iframe:  { action: 'load',   xml: <string> }      respond with current xml
  //   iframe → parent:  { event: 'save',    xml: <string>, modified: bool }
  //   iframe → parent:  { event: 'exit',    modified: bool }
  //   parent → iframe:  { action: 'export', format: 'xmlsvg' }   request preview
  //   iframe → parent:  { event: 'export',  data: 'data:image/svg+xml;...' }
  //
  // We only honour messages whose source is our iframe AND whose origin matches
  // the embed host. The XML is stored verbatim in the node's `xml` attribute;
  // the SVG preview goes in `previewSvg` so the closed-state thumbnail doesn't
  // need a network round-trip.

  const EMBED_HOST = 'https://embed.diagrams.net';
  const EMBED_URL =
    EMBED_HOST +
    '/?embed=1&proto=json&ui=min&libraries=1&modified=unsavedChanges&spin=1';

  const EMPTY_XML =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

  // How long to wait for the embed iframe to reply with its `init` event
  // before showing an error. Covers slow networks; 15s is generous.
  const INIT_TIMEOUT_MS = 15_000;
  // How long to wait for the SVG export reply after a save. If the iframe
  // never replies we still commit the xml so the user doesn't lose work;
  // the preview just stays as whatever it was previously.
  const EXPORT_TIMEOUT_MS = 5_000;

  // UTF-8 ↔ base64 round-trip. btoa/atob alone are latin1-only and corrupt
  // SVGs that contain non-ASCII characters (rare but possible in labels).
  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function base64ToUtf8(b64) {
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch {
      return '';
    }
  }

  // Reentrancy guard: don't open two overlays if the user double-clicks the
  // node. Tracked as a window property so the closure survives plugin reload.
  function setEditorOpen(v) { window.__tjDrawioEditorOpen = !!v; }
  function isEditorOpen() { return !!window.__tjDrawioEditorOpen; }

  // ── Modal overlay ───────────────────────────────────────────────────────────
  // Opening a diagram pops a full-viewport overlay containing the iframe. We
  // never embed the iframe inline in the entry because draw.io needs a lot of
  // chrome and a tall canvas.
  function openEditor(opts) {
    if (isEditorOpen()) return;  // ignore double-clicks
    setEditorOpen(true);

    const { initialXml, onSave, onClose } = opts;
    const overlay = document.createElement('div');
    overlay.className = 'tj-drawio-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      background: 'rgba(0, 0, 0, .6)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      justifyContent: 'stretch',
    });

    const frame = document.createElement('iframe');
    frame.src = EMBED_URL;
    // Sandbox + no-referrer keeps the external editor isolated from
    // TheJournal's auth + URLs. We still need allow-scripts (draw.io is
    // a JS app) and allow-same-origin for its internal local storage.
    frame.setAttribute('sandbox',
      'allow-scripts allow-same-origin allow-popups allow-forms allow-downloads');
    frame.referrerPolicy = 'no-referrer';
    Object.assign(frame.style, {
      flex: '1',
      border: '0',
      background: 'white',
    });
    overlay.appendChild(frame);

    // Inline error banner — used if init never lands. We render it but hide
    // until the timeout fires so the markup is ready.
    const errorBanner = document.createElement('div');
    Object.assign(errorBanner.style, {
      display: 'none',
      background: '#7f1d1d',
      color: 'white',
      padding: '14px 20px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      borderTop: '1px solid #ef4444',
      textAlign: 'center',
    });
    errorBanner.innerHTML =
      'Could not reach <strong>embed.diagrams.net</strong>. Check your network or try again later. ' +
      '<button type="button" id="tj-drawio-error-close" style="margin-left:12px;padding:4px 10px;border-radius:4px;border:1px solid white;background:transparent;color:white;cursor:pointer;">Close</button>';
    overlay.appendChild(errorBanner);

    document.body.appendChild(overlay);

    let savedAtLeastOnce = false;
    let pendingSaveXml = null;        // set when save lands; cleared after export reply
    let exportTimeoutHandle = null;
    let initTimeoutHandle = setTimeout(() => {
      // Show the network error banner; the iframe is probably blocked.
      errorBanner.style.display = 'block';
      const btn = errorBanner.querySelector('#tj-drawio-error-close');
      if (btn) btn.addEventListener('click', tearDown, { once: true });
    }, INIT_TIMEOUT_MS);

    function clearInitTimeout() {
      if (initTimeoutHandle != null) {
        clearTimeout(initTimeoutHandle);
        initTimeoutHandle = null;
      }
    }
    function clearExportTimeout() {
      if (exportTimeoutHandle != null) {
        clearTimeout(exportTimeoutHandle);
        exportTimeoutHandle = null;
      }
    }
    function commitPending(previewSvg) {
      if (pendingSaveXml === null) return;
      const xml = pendingSaveXml;
      pendingSaveXml = null;
      clearExportTimeout();
      const patch = { xml };
      if (previewSvg) patch.previewSvg = previewSvg;
      onSave(patch);
    }

    function messageHandler(event) {
      // Origin-bind the listener: ignore everything that isn't from the
      // diagrams.net frame we mounted. Without this any iframe on the page
      // could push xml into our node.
      if (event.source !== frame.contentWindow) return;
      if (event.origin !== EMBED_HOST) return;

      let msg;
      try { msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; }
      catch { return; }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.event) {
        case 'init':
          clearInitTimeout();
          // Embed is ready — push the current xml in.
          frame.contentWindow.postMessage(JSON.stringify({
            action: 'load',
            xml: initialXml || EMPTY_XML,
          }), EMBED_HOST);
          break;

        case 'save': {
          const xml = typeof msg.xml === 'string' ? msg.xml : '';
          pendingSaveXml = xml;
          savedAtLeastOnce = true;
          // Request an SVG export so the closed-state preview doesn't need
          // a network round-trip on every render.
          frame.contentWindow.postMessage(JSON.stringify({
            action: 'export',
            format: 'xmlsvg',
          }), EMBED_HOST);
          // If the export reply never lands, still commit the xml so the
          // user doesn't silently lose their work. The preview will stay
          // as whatever it was before this save.
          clearExportTimeout();
          exportTimeoutHandle = setTimeout(() => commitPending(null), EXPORT_TIMEOUT_MS);
          break;
        }

        case 'export':
          // SVG data URI. Strip the prefix so we store raw SVG markup;
          // smaller and easier to embed in an <img src="data:..."> later.
          if (typeof msg.data === 'string') {
            const svg = msg.data.startsWith('data:image/svg+xml;base64,')
              ? base64ToUtf8(msg.data.split(',')[1] || '')
              : null;
            commitPending(svg);
          }
          break;

        case 'exit':
          // Flush any save that was in flight before the user hit exit.
          if (pendingSaveXml !== null) commitPending(null);
          tearDown();
          break;
      }
    }

    function onEscape(ev) {
      if (ev.key === 'Escape') {
        if (pendingSaveXml !== null) commitPending(null);
        tearDown();
      }
    }

    function tearDown() {
      clearInitTimeout();
      clearExportTimeout();
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('keydown', onEscape);
      try { document.body.removeChild(overlay); } catch { /* already gone */ }
      setEditorOpen(false);
      onClose(savedAtLeastOnce);
    }

    window.addEventListener('message', messageHandler);
    window.addEventListener('keydown', onEscape);
  }

  // ── Tiptap node ─────────────────────────────────────────────────────────────
  window.TheJournalAPI.registerTiptapExtension({
    name: 'drawioDiagram',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        xml: {
          default: '',
          parseHTML: (el) => el.getAttribute('data-xml') || '',
          renderHTML: (attrs) => ({ 'data-xml': attrs.xml || '' }),
        },
        // SVG snapshot of the last saved state. Stored as a UTF-8 / base64
        // round-trip in the attribute so HTML attribute quoting doesn't
        // fight with embedded `<` and `"`. Could be hundreds of KB for a
        // complex diagram — acceptable trade-off for offline rendering.
        previewSvg: {
          default: '',
          parseHTML: (el) => {
            const raw = el.getAttribute('data-preview-svg-b64');
            return raw ? base64ToUtf8(raw) : '';
          },
          renderHTML: (attrs) => {
            const svg = attrs.previewSvg || '';
            return svg ? { 'data-preview-svg-b64': utf8ToBase64(svg) } : {};
          },
        },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="drawio-diagram"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', { ...HTMLAttributes, 'data-type': 'drawio-diagram' }];
    },

    addNodeView() {
      return ({ node, view, getPos }) => {
        let currentNode = node;
        const dom = document.createElement('div');
        dom.className = 'tj-drawio-diagram';
        Object.assign(dom.style, {
          border: '1px solid var(--color-border-primary, #374151)',
          borderRadius: '8px',
          margin: '12px 0',
          padding: '8px',
          background: 'var(--color-bg-card, rgba(255,255,255,.03))',
          color: 'var(--color-text-primary, currentColor)',
          cursor: 'pointer',
          overflow: 'hidden',
        });

        function updateAttrs(next) {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos === null || pos === undefined) return;
          const attrs = { ...currentNode.attrs, ...next };
          const tr = view.state.tr.setNodeMarkup(pos, undefined, attrs);
          view.dispatch(tr);
        }

        function render() {
          dom.innerHTML = '';
          const attrs = currentNode.attrs;

          const header = document.createElement('div');
          Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            fontSize: '12px',
            opacity: '.7',
          });
          const label = document.createElement('span');
          label.textContent = attrs.xml ? 'Draw.io diagram' : 'Empty diagram — click to draw';
          header.appendChild(label);

          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.textContent = 'Edit';
          Object.assign(editBtn.style, {
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid var(--color-border-primary, #374151)',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: '11px',
          });
          editBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openIfPosValid();
          });
          header.appendChild(editBtn);
          dom.appendChild(header);

          if (attrs.previewSvg) {
            // Render the SVG via <img src="data:..."> rather than inline.
            // Inline SVG inserted with innerHTML can execute <script> tags
            // — even though the export came from a sandboxed iframe, we
            // don't want to give it script access to TheJournal's DOM.
            // <img> renders SVG visually but blocks script execution.
            const preview = document.createElement('div');
            preview.style.maxHeight = '480px';
            preview.style.overflow = 'auto';
            preview.style.display = 'flex';
            preview.style.justifyContent = 'center';
            const img = document.createElement('img');
            img.alt = 'draw.io diagram';
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.src = 'data:image/svg+xml;base64,' + utf8ToBase64(attrs.previewSvg);
            preview.appendChild(img);
            dom.appendChild(preview);
          } else {
            const placeholder = document.createElement('div');
            placeholder.textContent = 'Click anywhere to open the editor.';
            Object.assign(placeholder.style, {
              textAlign: 'center',
              padding: '40px 20px',
              opacity: '.5',
              fontStyle: 'italic',
            });
            dom.appendChild(placeholder);
          }
        }

        function openIfPosValid() {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos === null || pos === undefined) return;
          openEditor({
            initialXml: currentNode.attrs.xml || '',
            onSave: (patch) => updateAttrs(patch),
            onClose: () => { /* preview re-renders via update() */ },
          });
        }

        dom.addEventListener('click', () => openIfPosValid());
        render();

        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type.name !== 'drawioDiagram') return false;
            currentNode = updatedNode;
            render();
            return true;
          },
        };
      };
    },
  });

  // ── Toolbar button ──────────────────────────────────────────────────────────
  if (typeof window.TheJournalAPI.registerToolbarButton === 'function') {
    window.TheJournalAPI.registerToolbarButton({
      id: 'drawio',
      label: 'Draw.io',
      title: 'Insert draw.io diagram',
      icon: 'git-merge',
      onClick(editor) {
        editor.chain().focus().insertContent({
          type: 'drawioDiagram',
          attrs: { xml: '', previewSvg: '' },
        }).run();
      },
    });
  }
})();
