import { describe, it, expect } from 'vitest';
import {
    buildCategoryTree,
    flattenTree,
    wouldCreateCycle,
    eligibleParentIds,
    resolveCategoryDrop,
    type CategoryNodeInput,
} from '../../src/lib/categoryTree';

type C = CategoryNodeInput & { Name?: string };

const cat = (id: number, parent: number | null = null, sort = 0): C => ({
    CategoryID: id, ParentCategoryID: parent, SortOrder: sort,
});

describe('buildCategoryTree', () => {
    it('nests children under parents and orders by SortOrder then id', () => {
        const tree = buildCategoryTree([
            cat(1), cat(2, 1, 1), cat(3, 1, 0), cat(4, 3),
        ]);
        expect(tree).toHaveLength(1);
        expect(tree[0].category.CategoryID).toBe(1);
        // child id 3 (sort 0) comes before id 2 (sort 1)
        expect(tree[0].children.map(n => n.category.CategoryID)).toEqual([3, 2]);
        expect(tree[0].children[0].children[0].category.CategoryID).toBe(4);
    });

    it('assigns depth per level', () => {
        const tree = buildCategoryTree([cat(1), cat(2, 1), cat(3, 2)]);
        expect(tree[0].depth).toBe(0);
        expect(tree[0].children[0].depth).toBe(1);
        expect(tree[0].children[0].children[0].depth).toBe(2);
    });

    it('treats a missing or self parent as a root', () => {
        const tree = buildCategoryTree([cat(1, 99), cat(2, 2)]);
        expect(tree.map(n => n.category.CategoryID).sort()).toEqual([1, 2]);
    });

    it('breaks ancestor cycles instead of looping (1->2->1)', () => {
        const tree = buildCategoryTree([cat(1, 2), cat(2, 1)]);
        // At least one node is promoted to root; the build terminates.
        const ids = flattenTree(tree).map(n => n.category.CategoryID).sort();
        expect(ids).toEqual([1, 2]);
        expect(tree.length).toBeGreaterThanOrEqual(1);
    });

    it('keeps every node reachable (no drops)', () => {
        const input = [cat(1), cat(2, 1), cat(3, 1), cat(4, 2), cat(5)];
        const flat = flattenTree(buildCategoryTree(input));
        expect(flat.map(n => n.category.CategoryID).sort()).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('flattenTree', () => {
    it('hides the subtree of a collapsed node but keeps the node', () => {
        const tree = buildCategoryTree([cat(1), cat(2, 1), cat(3, 2)]);
        const flat = flattenTree(tree, new Set([1]));
        expect(flat.map(n => n.category.CategoryID)).toEqual([1]);
        const flat2 = flattenTree(tree, new Set([2]));
        expect(flat2.map(n => n.category.CategoryID)).toEqual([1, 2]);
    });
});

describe('wouldCreateCycle', () => {
    const cats = [cat(1), cat(2, 1), cat(3, 2)];
    it('rejects making a node its own parent', () => {
        expect(wouldCreateCycle(cats, 1, 1)).toBe(true);
    });
    it('rejects making a descendant the new parent', () => {
        expect(wouldCreateCycle(cats, 1, 3)).toBe(true); // 3 descends from 1
        expect(wouldCreateCycle(cats, 1, 2)).toBe(true);
    });
    it('allows an unrelated or null parent', () => {
        expect(wouldCreateCycle(cats, 3, null)).toBe(false);
        expect(wouldCreateCycle([cat(1), cat(2)], 1, 2)).toBe(false);
    });
});

describe('eligibleParentIds', () => {
    it('excludes the node itself and its descendants', () => {
        const cats = [cat(1), cat(2, 1), cat(3, 2), cat(4)];
        expect(eligibleParentIds(cats, 1).sort()).toEqual([4]);
        expect(eligibleParentIds(cats, 3).sort()).toEqual([1, 2, 4]);
    });
});

describe('resolveCategoryDrop', () => {
    const cats = [cat(1), cat(2, 1), cat(3, 2), cat(4)];

    it('nests a dragged category under the drop target', () => {
        expect(resolveCategoryDrop(cats, 4, 1)).toEqual({ ok: true, parentId: 1 });
    });
    it('promotes to a root when dropped on the root zone (null target)', () => {
        expect(resolveCategoryDrop(cats, 2, null)).toEqual({ ok: true, parentId: null });
    });
    it('refuses a self-drop', () => {
        expect(resolveCategoryDrop(cats, 1, 1)).toEqual({ ok: false, parentId: null, reason: 'self' });
    });
    it('refuses a drop that would create a cycle (onto a descendant)', () => {
        expect(resolveCategoryDrop(cats, 1, 3)).toEqual({ ok: false, parentId: null, reason: 'cycle' });
    });
    it('treats dropping onto the existing parent as a no-op', () => {
        expect(resolveCategoryDrop(cats, 2, 1)).toEqual({ ok: false, parentId: 1, reason: 'no-op' });
        // already a root, dropped on root zone
        expect(resolveCategoryDrop(cats, 4, null)).toEqual({ ok: false, parentId: null, reason: 'no-op' });
    });
});
