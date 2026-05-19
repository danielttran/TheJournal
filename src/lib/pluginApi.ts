import { Node, type AnyExtension } from '@tiptap/core';

type TiptapExtensionInput = AnyExtension | Record<string, unknown>;
type ToolbarButtonInput = {
    id: string;
    label: string;
    title?: string;
    icon?: 'network' | 'git-merge';
    onClick: (editor: unknown) => void;
};
type ToolbarListener = (buttons: ToolbarButtonInput[]) => void;

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
    registeredToolbarButtons: [] as ToolbarButtonInput[],
    toolbarListeners: new Set<ToolbarListener>(),

    registerTiptapExtension(extension: TiptapExtensionInput) {
        this.registeredExtensions.push(toTiptapExtension(extension));
    },

    registerToolbarButton(button: ToolbarButtonInput) {
        if (!button?.id || typeof button.onClick !== 'function') return;
        this.registeredToolbarButtons = this.registeredToolbarButtons.filter(existing => existing.id !== button.id);
        this.registeredToolbarButtons.push(button);
        this.notifyToolbarListeners();
    },

    subscribeToolbarButtons(listener: ToolbarListener) {
        this.toolbarListeners.add(listener);
        listener([...this.registeredToolbarButtons]);
        return () => {
            this.toolbarListeners.delete(listener);
        };
    },

    notifyToolbarListeners() {
        const buttons = [...this.registeredToolbarButtons];
        this.toolbarListeners.forEach(listener => listener(buttons));
    },

    reset() {
        this.registeredExtensions = [];
        this.registeredToolbarButtons = [];
        this.notifyToolbarListeners();
    },
};

if (typeof window !== 'undefined') {
    (window as typeof window & { TheJournalAPI?: typeof TheJournalAPI }).TheJournalAPI = TheJournalAPI;
}
