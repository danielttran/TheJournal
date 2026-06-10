const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class SettingsManager {
    constructor() {
        this.userDataPath = app.getPath('userData');
        this.settingsPath = path.join(this.userDataPath, 'settings.json');
        this.defaults = {
            theme: 'dark',
            dbPath: 'default',
            userName: 'User',
            rememberMe: false,
            savedPassword: '',
            backupPath: '',
            autoBackupOnClose: false,
            backupFrequency: 3,
            retentionCount: 3,
            defaultFontSize: 14,
            // M3 security UX: 0 disables auto-lock; otherwise lock after N minutes idle.
            idleLockMinutes: 0,
            lockOnMinimize: false,
            // Window geometry restored on next launch (J8 remembers its size +
            // position). null = use the default 90%-of-screen geometry.
            windowBounds: null,
            windowMaximized: false,
            // When enabled, closing/minimizing hides to the system tray instead
            // of quitting; the app keeps running and reopens from the tray icon.
            minimizeToTray: false,
            openAtLogin: false,
            // Menu customization: full label-path ids the user has hidden from
            // the menus. Applied by applyMenuCustomization on both targets.
            menuHiddenItems: [],
            themePreferences: {
                light: { accentPrimary: '#9333ea', bgApp: '#f3f4f6', bgSidebar: '#ffffff' },
                dark: { accentPrimary: '#14b8a6', bgApp: '#000000', bgSidebar: '#000000' }
            }
        };
        this.settings = this.loadSettings();
    }

    loadSettings() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                return { ...this.defaults, ...JSON.parse(data) };
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
        return this.defaults;
    }

    saveSettings(newSettings) {
        try {
            this.settings = { ...this.settings, ...newSettings };
            // Atomic write: serialize to a sibling temp file then rename. A
            // crash or power loss mid-write leaves the original settings
            // intact instead of producing a truncated JSON file that fails to
            // parse on next startup.
            const tmp = this.settingsPath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 4));
            fs.renameSync(tmp, this.settingsPath);
            return true;
        } catch (error) {
            console.error('Error saving settings:', error);
            return false;
        }
    }

    getSettings() {
        return this.settings;
    }

    getSetting(key) {
        return this.settings[key];
    }
}

module.exports = SettingsManager;
