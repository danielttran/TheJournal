const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const getPort = require('get-port');

const dev = process.env.NODE_ENV !== 'production';
const dir = path.join(__dirname, '../../'); // Adjust based on where main.js is (src/electron/main.js -> root is ../../)

async function startServer() {
    // Set DB Path for Next.js to use
    if (!dev) {
        process.env.JOURNAL_DB_PATH = path.join(app.getPath('userData'), 'journal.db');
        console.log('Database Path:', process.env.JOURNAL_DB_PATH);
    }

    const port = await getPort({ port: getPort.makeRange(3000, 3100) });

    if (dev) {
        return { url: 'http://localhost:3000', port: 3000 };
    }

    // In production, we use Next.js programmatically
    // This requires 'next' to be in dependencies (not devDeps)
    const nextApp = next({ dev, dir });
    const handle = nextApp.getRequestHandler();

    await nextApp.prepare();

    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    return new Promise((resolve, reject) => {
        server.listen(port, (err) => {
            if (err) return reject(err);
            console.log(`> Ready on http://localhost:${port}`);
            resolve({ url: `http://localhost:${port}`, port, server });
        });
    });
}

let mainWindow;
let serverInstance;

function createWindow(url) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: Math.floor(width * 0.9),
        height: Math.floor(height * 0.9),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        backgroundColor: '#111827', // Match bg-bg-app
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#111827',
            symbolColor: '#9ca3af',
            height: 48 // Match header height
        }
    });

    mainWindow.loadURL(url);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    try {
        // If dev, we assume user ran 'npm run dev' separately or we wait for it
        // Or we can just point to 3000. 
        // For the "sidecar" plan, in DEV we usually point to localhost:3000

        let url;
        if (dev) {
            url = 'http://localhost:3000';
            // We could wait-on here, but scripts usually handle it. 
            // We just create window.
        } else {
            const serverInfo = await startServer();
            url = serverInfo.url;
            serverInstance = serverInfo.server;
        }

        createWindow(url);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
        });

    } catch (err) {
        console.error('Failed to start app:', err);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    if (serverInstance) {
        serverInstance.close();
    }
});
