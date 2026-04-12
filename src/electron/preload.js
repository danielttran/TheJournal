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
    onToggleTheme: (callback) => subscribe('toggle-theme', callback),
    onImportDB: (callback) => subscribe('import-db', callback, (_event, filePath) => [filePath]),
    onExportDB: (callback) => subscribe('export-db', callback),
    onLogoutRequest: (callback) => subscribe('logout-request', callback),
    onOpenSettings: (callback) => subscribe('open-settings', callback),
    onViewAction: (callback) => subscribe('view-action', callback, (_event, action) => [action]),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    storePassword: (pwd) => ipcRenderer.invoke('store-password', pwd),
    getStoredPassword: () => ipcRenderer.invoke('get-password')
});
