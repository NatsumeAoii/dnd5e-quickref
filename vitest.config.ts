import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/__tests__/**/*.test.ts', 'src/finalization/__tests__/**/*.test.ts'],
        globals: true,
        setupFiles: ['src/__tests__/setup.ts'],
        fileParallelism: false,
    },
});
