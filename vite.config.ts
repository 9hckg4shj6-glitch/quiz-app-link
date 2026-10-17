import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// 図は同じファイル名のまま差し替えることがある（誤りの修正など）。画像は CacheFirst なので、
// 名前が同じだと一度見た端末に古い図が残り続ける。中身が1枚でも変わったらキャッシュ名ごと変え、
// 全端末で取り直させる（古い名前のキャッシュは src/main.ts が消す）。
const imageHash = createHash("sha1");
for (const file of readdirSync("public/images", { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort()) {
  imageHash.update(file).update(readFileSync(file));
}
const IMAGE_CACHE = `study-images-${imageHash.digest("hex").slice(0, 10)}`;

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/quiz-app-link/" : "/",
  define: {
    // 管理画面の利用者一覧で、端末ごとにどの版を開いているかを見分ける（src/usage.ts → 018_app_version.sql）。
    __APP_VERSION__: JSON.stringify((process.env.GITHUB_SHA ?? "dev").slice(0, 7)),
    __IMAGE_CACHE__: JSON.stringify(IMAGE_CACHE),
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // 管理画面（admin.html）は別ページ。アプリからはリンクしない。
    rollupOptions: { input: { index: "index.html", admin: "admin.html" } },
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
        globIgnores: ["images/**", "subjects.js", "updates.js", "admin.html", "sw-maintenance.js"],
        // メンテナンス明けまで、新版が有効になったら開いているタブを強制的に読み直す（public/sw-maintenance.js）。
        importScripts: ["sw-maintenance.js"],
        // 管理画面はオフライン用のアプリ画面（index.html）へ差し替えず、常にネットワークから開く。
        navigateFallbackDenylist: [/admin\.html$/],
        // 既定の2MiBでは、ゲノム編の questions.js（2.1MB）がプリキャッシュから外れてビルドが失敗する。
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.endsWith("/subjects.js") || url.pathname.endsWith("/updates.js"),
            handler: "NetworkFirst",
            options: {
              cacheName: "study-manifest-v1",
              // GitHub Pages が max-age=600 を返すため、ふつうに取りに行くと
              // 最大10分はブラウザのHTTPキャッシュにある古いマニフェストが使われる。
              // 必ずサーバへ問い合わせ直す（変化が無ければ304で終わる）。
              fetchOptions: { cache: "no-cache" },
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
              cacheName: IMAGE_CACHE,
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
