import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the frontend calls relative /api/* and Vite proxies it to the backend.
// In production the backend serves the built frontend, so /api is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
