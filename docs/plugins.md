# Local Plugins

TheJournal supports trusted local plugins in the Electron app. Plugins are plain folders on disk that contain a `manifest.json` file and a `main.js` file.

Plugins run inside the renderer before the Tiptap editor mounts. This lets a plugin synchronously register custom Tiptap extensions and NodeViews through `window.TheJournalAPI`.

## Install A Plugin

Use the desktop menu:

1. Open **Plugins -> Install Plugin...**.
2. Select a plugin folder that contains `manifest.json` and `main.js`.
3. Choose **Reload Now** when prompted.

You can also use **Plugins -> Open Plugins Folder** and copy plugin folders there manually. The app creates this folder automatically:

```text
[Electron userData]/plugins/[plugin-id]/
```

On Windows development builds, this is typically:

```text
C:\Users\<you>\AppData\Roaming\temp-app\plugins
```

Packaged builds use the product name and are typically:

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

