import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 60_000,  // stress tests may run long
        hookTimeout: 30_000,
        reporters: ['verbose'],
        // Resolve @/* aliases so src/lib/db can be imported directly
        alias: {
            '@/': path.resolve(__dirname, 'src') + '/',
        },
    },
    resolve: {
        alias: {
            '@/': path.resolve(__dirname, 'src') + '/',
        },
    },
});
