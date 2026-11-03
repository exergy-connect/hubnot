import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  publicDir: 'static',
  build: {
    outDir: '../public',
    emptyOutDir: true,
    target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
    minify: 'oxc',
    cssMinify: true,
    sourcemap: false,
  },
});
