import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.STUDIO_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.STUDIO_API_PORT ?? 8787}`, changeOrigin: false } },
  },
  preview: { port: Number(process.env.STUDIO_WEB_PORT ?? 5173) },
});
