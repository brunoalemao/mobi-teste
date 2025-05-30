import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@emotion/react',
      '@emotion/styled',
      'framer-motion',
      'firebase/app',
      'firebase/firestore',
      'firebase/auth',
      'react-hot-toast'
    ]
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      external: []
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});
