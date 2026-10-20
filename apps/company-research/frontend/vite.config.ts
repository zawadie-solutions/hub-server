import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs, so the built UI works both at the root of its own server and behind
  // a path prefix such as the Zawadie Solutions Hub's /company-research/.
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
