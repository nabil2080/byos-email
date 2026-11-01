import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";

const hstsHeader = process.env.BYOS_HSTS_PRELOAD === "true"
  ? "max-age=31536000; includeSubDomains; preload"
  : "max-age=31536000";

const cspConnectSrc = process.env.NODE_ENV === "production" || process.env.BYOS_ENV === "production"
  ? "'self'"
  : "'self' http://127.0.0.1:8080 http://localhost:8080";

const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": hstsHeader,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src ${cspConnectSrc};`,
};

function securityHeadersPlugin() {
  return {
    name: "security-headers",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
          res.setHeader(key, value);
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
          res.setHeader(key, value);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  redirects: {
    "/register": "/signup",
    "/docs": "/support",
  },
  integrations: [solid()],
  vite: {
    plugins: [tailwindcss(), securityHeadersPlugin()],
    server: {
      headers: SECURITY_HEADERS,
      proxy: {
        "/v1": {
          target: process.env.PUBLIC_API_URL || "http://127.0.0.1:8080",
          changeOrigin: true,
        },
      },
    },
    preview: {
      headers: SECURITY_HEADERS,
    },
    css: {
      postcss: {
        plugins: [],
      },
    },
  },
  server: {
    headers: SECURITY_HEADERS,
    port: 3002,
    host: process.env.ASTRO_HOST || "0.0.0.0",
  },
});
