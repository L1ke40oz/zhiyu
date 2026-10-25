import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5188, strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3110', changeOrigin: false },
      '/party': { target: 'http://127.0.0.1:3110', changeOrigin: false, ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 850 },
});
