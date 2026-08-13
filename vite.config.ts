import { defineConfig, type IndexHtmlTransformContext } from 'vite';
import checker from 'vite-plugin-checker';

const appendCspSource = (html: string, directive: string, source: string): string => html.replace(
  new RegExp(`(\\b${directive})(\\s+)([^;]*)(;)`, 'i'),
  (match: string, name: string, spacing: string, sources: string, terminator: string): string => {
    if (sources.split(/\s+/).includes(source)) return match;
    return `${name}${spacing}${sources}${sources.endsWith(' ') ? '' : ' '}${source}${terminator}`;
  },
);

const applyDevelopmentCsp = (html: string, context: IndexHtmlTransformContext): string => {
  if (!context.server) return html;

  return appendCspSource(
    appendCspSource(html, 'style-src', "'unsafe-inline'"),
    'connect-src',
    'ws:',
  );
};

export default defineConfig({
  base: './',

  plugins: [
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: {
        order: 'post',
        handler: applyDevelopmentCsp,
      },
    },
    checker({
      typescript: { tsconfigPath: './tsconfig.app.json' },
      overlay: { initialIsOpen: false },
    }),
  ],

  build: {
    outDir: 'dist',
    // Production source maps are disabled because this public app has no private server code.
    sourcemap: false,
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
