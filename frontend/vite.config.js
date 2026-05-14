import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
var __dirname = dirname(fileURLToPath(import.meta.url));
// The Python wheel ships the built SPA from `src/model_lenz/frontend_dist/`,
// so emit there directly and FastAPI's static mount picks it up.
var OUT_DIR = resolve(__dirname, "../src/model_lenz/frontend_dist");
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: OUT_DIR,
        emptyOutDir: true,
        sourcemap: false,
        target: "es2020",
    },
    server: {
        port: 5173,
        proxy: {
            // During `npm run dev`, forward API calls to a locally-running model-lenz
            // server (start with: `model-lenz serve <pbip> --port 8765`).
            "/api": "http://127.0.0.1:8765",
            "/healthz": "http://127.0.0.1:8765",
        },
    },
});
