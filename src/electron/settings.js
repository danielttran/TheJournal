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
            fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 4));
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
