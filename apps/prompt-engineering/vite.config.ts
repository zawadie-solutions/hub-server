import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Served behind the Zawadie Solutions Hub at /prompt-engineering/, so every
// asset and route needs that prefix baked in (see src/lib/api.ts and the
// BrowserRouter basename in src/main.tsx).
export default defineConfig({
  base: '/prompt-engineering/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/prompt-engineering/api': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/prompt-engineering/, ''),
      },
    },
  },
})
