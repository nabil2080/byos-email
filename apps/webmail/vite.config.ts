import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid(), tailwindcss()],
  server: {
    port: 3001,
    host: "127.0.0.1",
    proxy: {
      "/v1": "http://127.0.0.1:8080",
    },
  },
  build: {
    target: "esnext"
  }
});
