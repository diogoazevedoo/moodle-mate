import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dashboard dev server. API + SSE are proxied to the local Fastify server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4319",
        changeOrigin: true,
      },
    },
  },
});
