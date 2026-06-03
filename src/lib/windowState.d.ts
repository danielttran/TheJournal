export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A display work area (screen minus taskbars), as Electron reports it. */
export interface WorkArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Validate + clamp saved bounds against the available display areas. Returns a
 * safe bounds object, or `null` when the saved value is missing/corrupt.
 */
export function clampWindowBounds(saved: unknown, areas: WorkArea[]): WindowBounds | null;
