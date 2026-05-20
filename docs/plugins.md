# Local Plugins

TheJournal supports trusted local plugins in both the Electron app **and** the
self-hosted web build. Plugins are plain folders on disk that contain a
`manifest.json` file and a `main.js` file.

Plugins run inside the renderer before the Tiptap editor mounts. This lets a plugin synchronously register custom Tiptap extensions and NodeViews through `window.TheJournalAPI`.

## Install A Plugin

### Electron (Desktop)

Three options — they all write to the same folder:

1. **Settings → Plugins → Install plugin…** (works in both Electron and web).
2. **Plugins → Install Plugin…** (native menu, Electron only).
3. Drop the folder directly into the Plugins folder via **Plugins → Open Plugins Folder**.

Reload the app afterwards to make the plugin available.

### Web (self-hosted)

Open **Settings → Plugins → Install plugin…** and pick the plugin folder.
The browser reads `manifest.json` + `main.js` from the folder and POSTs them
to `/api/plugins`; the server writes them into the plugin directory. Reload
the page after install.

You can also drop plugin folders directly into the plugin directory on the
server's filesystem (no UI needed). The location precedence is:

1. `JOURNAL_PLUGINS_DIR` env var (explicit override).
2. `<server cwd>/plugins/` (the repo's `plugins/` folder is auto-discovered).

When Electron launches it sets `JOURNAL_PLUGINS_DIR` to its userData/plugins
folder so the embedded Next.js server and the native Electron menu both
target the same location.

### Plugin folder locations

```text
Electron:  [Electron userData]/plugins/[plugin-id]/
Web:       <server cwd>/plugins/[plugin-id]/   (or $JOURNAL_PLUGINS_DIR)
```

On Windows development builds, the Electron path is typically:

```text
C:\Users\<you>\AppData\Roaming\temp-app\plugins
```

Packaged builds use the product name:

```text
C:\Users\<you>\AppData\Roaming\TheJournal\plugins
```

## Plugin Folder Structure

```text
my-plugin/
  manifest.json
  main.js
```

The folder name is used as the plugin id unless `manifest.json` includes an `id` field. The install menu sanitizes ids to letters, numbers, dots, underscores, and hyphens.

## manifest.json

```json
{
  "id": "drawio",
  "name": "Draw.io Embed",
  "version": "1.0.0",
  "description": "Renders an iframe for diagrams.net"
}
```

Only `manifest.json` and `main.js` are required. Other fields are metadata for users and future plugin-management UI.

## main.js

`main.js` is evaluated in the React renderer. It should register extensions synchronously:

```js
window.TheJournalAPI.registerTiptapExtension({
  name: 'drawio',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'drawio-node' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['drawio-node', HTMLAttributes];
  },
  addNodeView() {
    return () => {
      const container = document.createElement('div');
      container.style.width = '100%';
      container.style.height = '500px';

      const iframe = document.createElement('iframe');
      iframe.src = 'https://embed.diagrams.net/?embed=1&ui=min&spin=1';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '1px solid #ccc';

      container.appendChild(iframe);
      return { dom: container };
    };
  },
});
```

The API accepts either a Tiptap extension instance or a plain Tiptap node configuration object like the example above.

## Runtime Rules

- Plugins are trusted local scripts. Install only plugins you trust.
- Plugin scripts execute before the editor is created.
- Registration must be synchronous. Async work can happen later inside a NodeView or command, but extensions must be registered during initial script execution.
- A plugin with invalid JSON or a script error is skipped and logged; other plugins still load.
- The app continues normally when the plugins folder is missing or empty.

## Current API

```js
window.TheJournalAPI.registerTiptapExtension(extension);
```

Registers a Tiptap extension for the editor. Registered extensions are appended after TheJournal's built-in editor extensions.

```js
window.TheJournalAPI.registerToolbarButton({
  id: 'my-plugin-button',
  label: 'My Tool',
  title: 'Insert my custom block',
  icon: 'network',
  onClick(editor) {
    editor.chain().focus().insertContent({ type: 'myCustomNode' }).run();
  },
});
```

Adds a toolbar button after the built-in editor tools. Supported icon keys are `network` and `git-merge`.

## Included Example Plugins

The repository includes installable example plugins under `plugins/`:

- `plugins/sentence-diagrammer` - interactive Reed-Kellogg sentence diagrams with draggable word tokens and relationship-based AST storage.
