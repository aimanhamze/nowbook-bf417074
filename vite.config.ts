import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

// Build identity shown in provider Settings (src/lib/appVersion.ts): UTC build
// date + short commit. Vercel exposes the commit as VERCEL_GIT_COMMIT_SHA; a
// local build asks git; with neither, the date alone still tells builds apart.
function buildVersion(): string {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      sha = "";
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  return sha ? `${date} · ${sha.slice(0, 7)}` : date;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "pwa-icon-192.png", "pwa-icon-512.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        importScripts: ["/sw-push.js"],
      },
      manifest: {
        name: "Ehjezly — הזמנת תורים",
        short_name: "Ehjezly",
        description: "הזמנת תורים בקלות",
        lang: "he",
        theme_color: "#fcfcfc",
        background_color: "#fcfcfc",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        screenshots: [
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            form_factor: "narrow",
          },
        ],
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["leaflet", "react-leaflet-cluster"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-ui": ["framer-motion", "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs", "@radix-ui/react-dropdown-menu"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-map": ["leaflet", "react-leaflet", "react-leaflet-cluster"],
        },
      },
    },
  },
}));
