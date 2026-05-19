import { Node, type AnyExtension } from '@tiptap/core';

type TiptapExtensionInput = AnyExtension | Record<string, unknown>;

const toTiptapExtension = (extension: TiptapExtensionInput): AnyExtension => {
    if (
        typeof extension === 'object' &&
        extension !== null &&
        !('type' in extension) &&
        ('group' in extension || 'content' in extension || 'parseHTML' in extension || 'renderHTML' in extension)
    ) {
        return Node.create(extension);
    }

    return extension as AnyExtension;
};

export const TheJournalAPI = {
    registeredExtensions: [] as AnyExtension[],

    registerTiptapExtension(extension: TiptapExtensionInput) {
        this.registeredExtensions.push(toTiptapExtension(extension));
    },

    reset() {
        this.registeredExtensions = [];
    },
};

if (typeof window !== 'undefined') {
    (window as typeof window & { TheJournalAPI?: typeof TheJournalAPI }).TheJournalAPI = TheJournalAPI;
}

