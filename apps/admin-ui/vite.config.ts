import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const apiTarget = process.env.VITE_ADMIN_API_TARGET ?? 'http://127.0.0.1:8081';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/health': {
        target: apiTarget,
        changeOrigin: false,
      },
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/health': {
        target: apiTarget,
        changeOrigin: false,
      },
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        'admin-ui-core': path.resolve(rootDir, 'index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Keep route-scoped Radix Tabs primitives out of the eager global vendor chunk
            if (
              id.includes('@radix-ui/react-tabs') ||
              id.includes('@radix-ui/react-roving-focus') ||
              id.includes('@radix-ui/react-collection')
            ) {
              return undefined;
            }
            return 'vendors';
          }
          return undefined;
        },
      },
    },
  },
});
