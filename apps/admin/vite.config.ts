import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: without it, "/api" also prefix-matches the
      // client-side route "/api-keys", proxying that page load to the API
      // server instead of letting Vite serve the SPA shell for it.
      '/api/': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
