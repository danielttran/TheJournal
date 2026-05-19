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
    onToggleTheme: (callback) => subscribe('toggle-theme', callback),
    onImportDB: (callback) => subscribe('import-db', callback, (_event, filePath) => [filePath]),
    onExportDB: (callback) => subscribe('export-db', callback),
    onLogoutRequest: (callback) => subscribe('logout-request', callback),
    onOpenSettings: (callback) => subscribe('open-settings', callback),
    onViewAction: (callback) => subscribe('view-action', callback, (_event, action) => [action]),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    exportDatabase: () => ipcRenderer.invoke('export-database'),
    importDatabase: () => ipcRenderer.invoke('import-database-dialog'),
    storePassword: (pwd) => ipcRenderer.invoke('store-password', pwd),
    getStoredPassword: () => ipcRenderer.invoke('get-password'),
    readFileForImport: (filePath) => ipcRenderer.invoke('read-file-for-import', filePath),

    // David RM parity — File menu hooks. The renderer owns the "current
    // entry" state; main fires these channels when the user picks the menu
    // item, and the renderer responds by either calling window.print() or
    // asking main to write the rendered HTML to a chosen PDF path.
    onPrintCurrentEntry:     (cb) => subscribe('print-current-entry', cb),
    onExportCurrentEntryPdf: (cb) => subscribe('export-current-entry-pdf', cb),
    onOpenJournal:           (cb) => subscribe('open-journal', cb, (_event, filePath) => [filePath]),
    saveEntryPdf:            (entryHtml, suggestedName) =>
        ipcRenderer.invoke('save-entry-pdf', entryHtml, suggestedName),
});
