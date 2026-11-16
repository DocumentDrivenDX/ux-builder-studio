/* The renderer's development harness: npx vite --config packages/app-runtime/dev/vite.config.ts --port 5199 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { fs: { allow: [repo] } },
  resolve: { dedupe: ["react", "react-dom"] },
});
