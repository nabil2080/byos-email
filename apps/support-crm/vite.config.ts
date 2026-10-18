import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 3003,
    host: process.env.VITE_HOST || "0.0.0.0",
    proxy: {
      "/admin/v1": process.env.VITE_ADMIN_API_URL || "http://127.0.0.1:8087",
    },
  },
  build: {
    target: "esnext"
  }
});
