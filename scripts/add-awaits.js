const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(fullPath));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            results.push(fullPath);
        }
    });
    return results;
}

const files = walk(path.join(__dirname, '../src'));
let changed = 0;

files.forEach(file => {
    // Skip the database driver and the export wrapper
    if (file.includes('src\\\\lib\\\\db.ts') || file.includes('src/lib/db.ts')) return;

    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('db.prepare(')) {
        // Lookbehind to prevent double awaits: (?<!await\s+)
        const regex = /(?<!await\s+)db\.prepare\(/g;
        let newContent = content.replace(regex, 'await db.prepare(');

        if (content !== newContent) {
            fs.writeFileSync(file, newContent);
            changed++;
            console.log('Updated: ' + file);
        }
    }
});

console.log('Total files changed: ' + changed);
