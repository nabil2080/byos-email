import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid(), tailwindcss()],
  server: {
    port: 3001,
    host: process.env.VITE_HOST || "0.0.0.0",
    proxy: {
      "/v1": process.env.VITE_API_URL || "http://127.0.0.1:8080",
      "/api/v1": process.env.VITE_API_URL || "http://127.0.0.1:8080",
    },
  },
  build: {
    target: "esnext",
    modulePreload: {
      resolveDependencies: (filename, deps) => {
        return deps.filter((dep) => !dep.includes("highlight"));
      },
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("highlight.js") || id.includes("hljs_custom")) {
            return "highlight";
          }
        },
      },
    },
  }
});
