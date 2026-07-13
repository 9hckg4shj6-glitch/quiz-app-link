import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/quiz-app-link/" : "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "代謝・生化学 問題演習",
        short_name: "代謝演習",
        description: "問題演習とFSRSフラッシュカードで学ぶオフライン対応学習アプリ",
        theme_color: "#147d8f",
        background_color: "#f6f8f7",
        display: "standalone",
        start_url: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,json,svg,png,webp,woff2}"],
        globIgnores: ["images/**"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/images/"),
            handler: "CacheFirst",
            options: {
              cacheName: "study-images-v2",
              expiration: { maxEntries: 220, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
});
