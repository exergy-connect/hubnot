import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  publicDir: 'static',
  build: {
    outDir: '../docs',
    // docs/ also contains hand-written project documentation.
    emptyOutDir: false,
    assetsDir: 'browser-assets',
    target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
    minify: 'oxc',
    cssMinify: true,
    sourcemap: false,
  },
});
