/**
 * Lightweight 3-way merge for resolving 409 version conflicts on entry save.
 * Operates on line-level deltas — sufficient for journal entry text where
 * paragraphs are typically separated by blank lines.
 *
 * Not a full operational-transform engine — when both sides edit the SAME
 * line, we surface the conflict for manual UI resolution.
 */

export interface ConflictDiff {
    common: string[];
    serverOnly: string[];
    clientOnly: string[];
}

export function computeConflictDiff(base: string, server: string, client: string): ConflictDiff {
    const baseLines = new Set(base.split('\n'));
    const serverLines = server.split('\n');
    const clientLines = client.split('\n');

    const serverSet = new Set(serverLines);
    const clientSet = new Set(clientLines);

    const common: string[] = [];
    const serverOnly: string[] = [];
    const clientOnly: string[] = [];

    for (const line of serverLines) {
        if (clientSet.has(line)) common.push(line);
        else if (!baseLines.has(line)) serverOnly.push(line);
    }
    for (const line of clientLines) {
        if (!serverSet.has(line) && !baseLines.has(line)) clientOnly.push(line);
    }
    return { common, serverOnly, clientOnly };
}

export interface MergeResult {
    merged: string;
    conflict: boolean;
}

/**
 * Attempt a 3-way merge:
 *   1. Walk the shared prefix (lines identical in base/server/client)
 *   2. Walk the shared suffix (same idea, working backward)
 *   3. Compare the "middle" segments left over from server vs client vs base
 *      - If server-middle == base-middle, take client-middle
 *      - If client-middle == base-middle, take server-middle
 *      - Otherwise: both sides edited the middle → conflict (3-way markers)
 *
 * This naturally handles "both sides only appended new lines after a shared
 * prefix" — the prefix walk consumes the common part, then server/client
 * middles are both pure additions relative to base, so they concatenate.
 */
export function autoMerge(base: string, server: string, client: string): MergeResult {
    const baseLines = base.split('\n');
    const serverLines = server.split('\n');
    const clientLines = client.split('\n');

    // Shared prefix
    let prefixLen = 0;
    while (
        prefixLen < baseLines.length &&
        prefixLen < serverLines.length &&
        prefixLen < clientLines.length &&
        baseLines[prefixLen] === serverLines[prefixLen] &&
        baseLines[prefixLen] === clientLines[prefixLen]
    ) prefixLen++;

    // Shared suffix
    let suffixLen = 0;
    while (
        suffixLen < baseLines.length - prefixLen &&
        suffixLen < serverLines.length - prefixLen &&
        suffixLen < clientLines.length - prefixLen &&
        baseLines[baseLines.length - 1 - suffixLen] === serverLines[serverLines.length - 1 - suffixLen] &&
        baseLines[baseLines.length - 1 - suffixLen] === clientLines[clientLines.length - 1 - suffixLen]
    ) suffixLen++;

    const baseMid = baseLines.slice(prefixLen, baseLines.length - suffixLen);
    const serverMid = serverLines.slice(prefixLen, serverLines.length - suffixLen);
    const clientMid = clientLines.slice(prefixLen, clientLines.length - suffixLen);
    const prefix = baseLines.slice(0, prefixLen);
    const suffix = baseLines.slice(baseLines.length - suffixLen);

    let middle: string[];
    let conflict = false;
    const serverSame = serverMid.join('\n') === baseMid.join('\n');
    const clientSame = clientMid.join('\n') === baseMid.join('\n');

    if (serverSame && clientSame) {
        middle = baseMid;
    } else if (serverSame) {
        middle = clientMid;
    } else if (clientSame) {
        middle = serverMid;
    } else if (serverMid.join('\n') === clientMid.join('\n')) {
        // Same edit on both sides
        middle = serverMid;
    } else if (baseMid.length === 0) {
        // Both sides added different content where base was empty —
        // concatenate rather than conflict (pure-append case)
        middle = [...serverMid, ...clientMid];
    } else {
        conflict = true;
        middle = ['<<<<<<< server', ...serverMid, '=======', ...clientMid, '>>>>>>> client'];
    }

    return { merged: [...prefix, ...middle, ...suffix].join('\n'), conflict };
}
