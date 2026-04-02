import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

export default defineConfig({
  base: './',

  plugins: [
    checker({
      typescript: { tsconfigPath: './tsconfig.app.json' },
      overlay: { initialIsOpen: false },
    }),
  ],

  build: {
    outDir: 'dist',
    sourcemap: true,
    cssMinify: 'lightningcss',
    // Inline assets up to 10KB as base64 data URIs — covers all icon webp files
    // (~5KB avg, ~10KB max), eliminating 90 separate HTTP requests in production.
    assetsInlineLimit: 10240,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },

  css: {
    transformer: 'lightningcss',
  },

  server: {
    open: true,
    strictPort: false,
  },
});
