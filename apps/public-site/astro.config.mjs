import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";

export default defineConfig({
  integrations: [solid()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/v1": {
          target: "http://127.0.0.1:8080",
          changeOrigin: true,
        },
      },
    },
    css: {
      postcss: {
        plugins: [],
      },
    },
  },
  server: {
    port: 3002,
    host: "127.0.0.1",
  },
});
