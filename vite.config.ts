import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

export default defineConfig({
  base: './',

  plugins: [
    checker({
      typescript: true,
      overlay: { initialIsOpen: false },
    }),
  ],

  build: {
    outDir: 'dist',
    sourcemap: true,
    cssMinify: 'lightningcss',
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
