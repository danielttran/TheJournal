const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
    onToggleTheme: (callback) => ipcRenderer.on('toggle-theme', () => callback()),
    onImportDB: (callback) => ipcRenderer.on('import-db', (_event, filePath) => callback(filePath)),
    onExportDB: (callback) => ipcRenderer.on('export-db', () => callback())
});
