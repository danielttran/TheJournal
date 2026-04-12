#!/usr/bin/env node
/**
 * scripts/download-fonts.js
 *
 * Downloads Geist and Geist Mono woff2 font files into public/fonts/ so
 * that next/font/local can be used instead of next/font/google.
 *
 * Run once before building:   node scripts/download-fonts.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');

// Font files are served via jsDelivr (mirrors the vercel/geist-font npm package).
// Adjust the version tag if you need a specific release.
const GEIST_VERSION      = '1.3.0';
const GEIST_MONO_VERSION = '1.3.0';

const BASE_URL = `https://cdn.jsdelivr.net/npm/geist@${GEIST_VERSION}/dist/fonts`;

const FONTS = [
    // Geist Sans — weights used in the UI
    { url: `${BASE_URL}/geist-sans/Geist-Thin.woff2`,        dest: 'Geist-Thin.woff2' },
    { url: `${BASE_URL}/geist-sans/Geist-Light.woff2`,       dest: 'Geist-Light.woff2' },
    { url: `${BASE_URL}/geist-sans/Geist-Regular.woff2`,     dest: 'Geist-Regular.woff2' },
    { url: `${BASE_URL}/geist-sans/Geist-Medium.woff2`,      dest: 'Geist-Medium.woff2' },
    { url: `${BASE_URL}/geist-sans/Geist-SemiBold.woff2`,    dest: 'Geist-SemiBold.woff2' },
    { url: `${BASE_URL}/geist-sans/Geist-Bold.woff2`,        dest: 'Geist-Bold.woff2' },
    // Geist Mono — weights used in the UI
    { url: `${BASE_URL}/geist-mono/GeistMono-Regular.woff2`, dest: 'GeistMono-Regular.woff2' },
    { url: `${BASE_URL}/geist-mono/GeistMono-Medium.woff2`,  dest: 'GeistMono-Medium.woff2' },
    { url: `${BASE_URL}/geist-mono/GeistMono-Bold.woff2`,    dest: 'GeistMono-Bold.woff2' },
];

function download(url, destPath) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(destPath)) {
            console.log(`  [skip] ${path.basename(destPath)} — already exists`);
            return resolve();
        }

        console.log(`  [dl]   ${url}`);
        const file = fs.createWriteStream(destPath);

        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                // Follow redirects (jsDelivr uses 301/302 for some assets)
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    file.destroy();
                    fs.unlinkSync(destPath);
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    file.destroy();
                    fs.unlinkSync(destPath);
                    return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
                }
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            }).on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        };

        request(url);
    });
}

async function main() {
    if (!fs.existsSync(FONTS_DIR)) {
        fs.mkdirSync(FONTS_DIR, { recursive: true });
        console.log(`Created ${FONTS_DIR}`);
    }

    console.log(`Downloading ${FONTS.length} font files to ${FONTS_DIR}…\n`);
    for (const { url, dest } of FONTS) {
        await download(url, path.join(FONTS_DIR, dest));
    }
    console.log('\n✅  All fonts downloaded successfully.');
    console.log('    Update src/app/layout.tsx to use next/font/local pointing to public/fonts/.');
}

main().catch((err) => {
    console.error('\n❌  Font download failed:', err.message);
    process.exit(1);
});
