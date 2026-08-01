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
      // 新版を検出したら待機させずに有効化し、古いPWA画面を自動で更新する。
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "基礎医学演習アプリ",
        short_name: "基礎医学演習アプリ",
        description: "問題演習とFSRSフラッシュカードで学ぶオフライン対応学習アプリ",
        theme_color: "#eaf2ff",
        background_color: "#f3f6fb",
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
        // subjects.js（科目マニフェスト）と updates.js（更新履歴）はプリキャッシュしない。
        // この2つは「何が存在するか」を決めるファイルなので、古いものが使われると
        // Service Worker が入れ替わるまで、追加した科目が「準備中」のまま出たり
        // 更新履歴が古いまま出たりする。どちらも数十KBなので、オンラインなら
        // 必ずネットワークから取り直し、オフラインのときだけキャッシュへ落とす。
        globIgnores: ["images/**", "subjects.js", "updates.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.endsWith("/subjects.js") || url.pathname.endsWith("/updates.js"),
            handler: "NetworkFirst",
            options: {
              cacheName: "study-manifest-v1",
              networkTimeoutSeconds: 5,   // 回線が悪いときはキャッシュへ即座に切り替える
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // 新しく追加した科目の問題データは、まだ古いプリキャッシュに載っていない。
            // プリキャッシュ側で拾えなかったぶんを実行時にも保存し、次からオフラインで開けるようにする。
            // （既存科目のファイルはプリキャッシュのルートが先に処理するのでここへは来ない）
            urlPattern: ({ url }) => url.pathname.includes("/subjects/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "study-subjects-v1",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/images/"),
            handler: "CacheFirst",
            options: {
              cacheName: "study-images-v3",
              // 科目が増えると図も増える。上限が総枚数を下回ると、
              // 古い科目の図がキャッシュから追い出されてオフラインで見られなくなる。
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
});
