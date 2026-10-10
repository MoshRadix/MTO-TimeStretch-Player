import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { port: 5173, strictPort: true }, build: { outDir: 'web-dist', emptyOutDir: true } });
