import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para funcionar no GitHub Pages e em qualquer subcaminho.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
