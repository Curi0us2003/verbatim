import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1", // only this computer can open the app
    port: 5173,
    proxy: {
      // The browser talks to Vite; Vite forwards /api calls to FastAPI.
      "/api": "http://127.0.0.1:8000",
    },
  },
});
