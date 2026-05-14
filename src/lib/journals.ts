import { readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

/**
 * Multi-journal directory listing — David RM parity for "Open another
 * journal…". Pure fs over a directory; the caller (Electron main) decides
 * which file to actually open.
 *
 * A `.tjdb` file is a SQLCipher database; its `.tjdb-wal` and `.tjdb-shm`
 * siblings are SQLite's write-ahead-log and shared-memory files and are
 * filtered OUT of the listing.
 */

export interface JournalFile {
    /** Absolute path. */
    path: string;
    /** Filename without the `.tjdb` extension — handy for tab labels. */
    name: string;
    /** Bytes on disk. */
    size: number;
    /** Last-modified timestamp. */
    modifiedAt: Date;
}

const PRIMARY_EXT = '.tjdb';
// SQLite WAL/SHM siblings; never standalone journals.
const SIDECAR_SUFFIXES = ['-shm', '-wal'];

function isSidecar(name: string): boolean {
    return SIDECAR_SUFFIXES.some(s => name.endsWith(PRIMARY_EXT + s));
}

/**
 * Returns every `.tjdb` file directly inside `dirPath`, newest-first.
 * Non-`.tjdb` files and the `-shm`/`-wal` siblings are skipped. Returns
 * an empty array (not an error) when the directory does not exist.
 */
export async function listJournalsInDirectory(dirPath: string): Promise<JournalFile[]> {
    let entries: string[];
    try {
        entries = await readdir(dirPath);
    } catch {
        return [];
    }

    const out: JournalFile[] = [];
    for (const filename of entries) {
        if (isSidecar(filename)) continue;
        if (extname(filename).toLowerCase() !== PRIMARY_EXT) continue;
        const full = join(dirPath, filename);
        let s;
        try { s = await stat(full); } catch { continue; }
        if (!s.isFile()) continue;
        out.push({
            path: full,
            name: basename(filename, PRIMARY_EXT),
            size: s.size,
            modifiedAt: s.mtime,
        });
    }
    out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return out;
}

/**
 * Best-effort lock probe: true when one of the SQLite WAL/SHM siblings is
 * present, suggesting another process has the database open. NOT a guarantee
 * — a clean shutdown removes them — but enough to warn the user before they
 * try to open the same DB twice.
 */
export async function isJournalLikelyOpen(journalPath: string): Promise<boolean> {
    for (const suffix of SIDECAR_SUFFIXES) {
        try {
            const s = await stat(journalPath + suffix);
            if (s.isFile() && s.size > 0) return true;
        } catch { /* sibling absent → not open */ }
    }
    return false;
}
