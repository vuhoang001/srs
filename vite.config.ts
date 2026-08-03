import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend chay o 5173, moi request /api duoc chuyen (proxy) sang API o 3001.
// Nho vay dev chi mo mot URL duy nhat: http://localhost:5173
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
})
