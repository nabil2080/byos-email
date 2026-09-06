import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid(), tailwindcss()],
  server: {
    port: 3000,
    host: "127.0.0.1",
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext"
  }
});
