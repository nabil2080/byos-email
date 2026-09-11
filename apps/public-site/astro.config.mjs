import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    css: {
      postcss: false,
    },
  },
  server: {
    port: 3002,
    host: "127.0.0.1",
  },
});
