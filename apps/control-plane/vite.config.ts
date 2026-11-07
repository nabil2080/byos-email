import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid(), tailwindcss()],
  server: {
    port: 3000,
    host: process.env.VITE_HOST || "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_URL || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_API_URL || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext"
  }
});
