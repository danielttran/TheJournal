/**
 * Hierarchical category tree (J8 "View as Loose-leaf" at the category level).
 *
 * Categories carry an optional `ParentCategoryID`. This module turns the flat,
 * per-user category list into a nested tree and owns the cycle-safety maths so
 * the API and UI never build an infinite loop. Pure + DOM-free for unit tests.
 *
 * Robustness rules (a corrupt/legacy row must never hang the UI):
 *  - A parent that is missing, is the node itself, or forms an ancestor cycle is
 *    ignored — the node becomes a root instead.
 *  - Children are ordered by SortOrder then CategoryID (stable).
 */

export interface CategoryNodeInput {
    CategoryID: number;
    ParentCategoryID?: number | null;
    SortOrder?: number;
}

export interface CategoryTreeNode<T extends CategoryNodeInput> {
    category: T;
    children: CategoryTreeNode<T>[];
    depth: number;
}

/** Resolve the effective parent id for a node, or null if it should be a root. */
function safeParentId<T extends CategoryNodeInput>(byId: Map<number, T>, c: T): number | null {
    const p = c.ParentCategoryID ?? null;
    if (p == null || p === c.CategoryID || !byId.has(p)) return null;
    // Walk ancestors; if we loop back to this node (or any repeat), break the edge.
    const seen = new Set<number>([c.CategoryID]);
    let cur: number | null = p;
    while (cur != null) {
        if (seen.has(cur)) return null;
        seen.add(cur);
        const parent: number | null = byId.get(cur)?.ParentCategoryID ?? null;
        cur = parent != null && parent !== cur && byId.has(parent) ? parent : null;
    }
    return p;
}

export function buildCategoryTree<T extends CategoryNodeInput>(cats: T[]): CategoryTreeNode<T>[] {
    const byId = new Map<number, T>();
    for (const c of cats) byId.set(c.CategoryID, c);

    const nodes = new Map<number, CategoryTreeNode<T>>();
    for (const c of cats) nodes.set(c.CategoryID, { category: c, children: [], depth: 0 });

    const roots: CategoryTreeNode<T>[] = [];
    for (const c of cats) {
        const node = nodes.get(c.CategoryID)!;
        const p = safeParentId(byId, c);
        if (p == null) roots.push(node);
        else nodes.get(p)!.children.push(node);
    }

    const sortFn = (a: CategoryTreeNode<T>, b: CategoryTreeNode<T>) =>
        (a.category.SortOrder ?? 0) - (b.category.SortOrder ?? 0)
        || a.category.CategoryID - b.category.CategoryID;

    const order = (list: CategoryTreeNode<T>[], depth: number) => {
        list.sort(sortFn);
        for (const n of list) { n.depth = depth; order(n.children, depth + 1); }
    };
    order(roots, 0);
    return roots;
}

/**
 * Pre-order flatten respecting a set of collapsed parent ids — the render order
 * for a vertical tree. A collapsed node still appears; its subtree is hidden.
 */
export function flattenTree<T extends CategoryNodeInput>(
    roots: CategoryTreeNode<T>[],
    collapsed: ReadonlySet<number> = new Set(),
): CategoryTreeNode<T>[] {
    const out: CategoryTreeNode<T>[] = [];
    const walk = (list: CategoryTreeNode<T>[]) => {
        for (const n of list) {
            out.push(n);
            if (!collapsed.has(n.category.CategoryID)) walk(n.children);
        }
    };
    walk(roots);
    return out;
}

/**
 * True if re-parenting `id` under `newParentId` would create a cycle: the new
 * parent is the node itself or one of its descendants. Used as the API guard.
 */
export function wouldCreateCycle<T extends CategoryNodeInput>(
    cats: T[], id: number, newParentId: number | null,
): boolean {
    if (newParentId == null) return false;
    if (newParentId === id) return true;
    const byId = new Map(cats.map(c => [c.CategoryID, c] as const));
    if (!byId.has(newParentId)) return false; // unknown parent rejected elsewhere
    const seen = new Set<number>();
    let cur: number | null = newParentId;
    while (cur != null) {
        if (cur === id) return true;        // newParent descends from id → cycle
        if (seen.has(cur)) break;           // pre-existing cycle: stop
        seen.add(cur);
        cur = byId.get(cur)?.ParentCategoryID ?? null;
    }
    return false;
}

/** Category ids that may legally become the parent of `id` (excludes id + its descendants). */
export function eligibleParentIds<T extends CategoryNodeInput>(cats: T[], id: number): number[] {
    return cats.filter(c => c.CategoryID !== id && !wouldCreateCycle(cats, id, c.CategoryID))
        .map(c => c.CategoryID);
}
