import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid({ hot: false })],
  test: {
    environment: "happy-dom",
    globals: true,
    isolate: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "src/*.test.ts",
      "src/utils/*.test.ts",
      "src/components/notes/*.test.ts",
      "node_modules/**",
      "dist/**",
    ],
    deps: {
      optimizer: {
        client: {
          include: ["solid-js"],
        },
      },
    },
  },
});
