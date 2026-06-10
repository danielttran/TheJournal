const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback, mapArgs = (_event, ...args) => args) => {
    const listener = (event, ...args) => callback(...mapArgs(event, ...args));
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('electron', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
    logout: () => ipcRenderer.invoke('logout'),
    getPlugins: () => ipcRenderer.invoke('get-plugins'),
    onImportDB: (callback) => subscribe('import-db', callback, (_event, filePath) => [filePath]),
    onExportDB: (callback) => subscribe('export-db', callback),
    onViewAction: (callback) => subscribe('view-action', callback, (_event, action) => [action]),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    exportDatabase: () => ipcRenderer.invoke('export-database'),
    importDatabase: () => ipcRenderer.invoke('import-database-dialog'),
    storePassword: (pwd) => ipcRenderer.invoke('store-password', pwd),
    getStoredPassword: () => ipcRenderer.invoke('get-password'),

    // David RM parity — File menu hooks. The renderer owns the "current
    // entry" state; main fires these channels when the user picks the menu
    // item, and the renderer responds by either calling window.print() or
    // asking main to write the rendered HTML to a chosen PDF path.
    onPrintCurrentEntry:     (cb) => subscribe('print-current-entry', cb),
    saveEntryPdf:            (entryHtml, suggestedName) =>
        ipcRenderer.invoke('save-entry-pdf', entryHtml, suggestedName),

    // M3 security UX: main fires this when the window is minimized and
    // lockOnMinimize is enabled, so the renderer can route to /login.
    onLockApp:               (cb) => subscribe('lock-app', cb, (_event, payload) => [payload]),
});
