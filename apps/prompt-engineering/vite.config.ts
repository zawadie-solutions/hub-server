import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Hosted standalone on Vercel (promtkit.vercel.app), not embedded behind the
// hub, so assets and routes are served from the root (see src/lib/api.ts and
// the BrowserRouter basename in src/main.tsx, both of which derive from
// import.meta.env.BASE_URL and need no further changes).
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
})
