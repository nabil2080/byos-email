import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 3003,
    host: "127.0.0.1",
    proxy: {
      "/admin/v1": "http://127.0.0.1:8087",
    },
  },
  build: {
    target: "esnext"
  }
});
