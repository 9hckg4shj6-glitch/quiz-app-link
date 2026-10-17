/// <reference types="vite/client" />

declare module "virtual:pwa-register" {
  export function registerSW(options?: {
    immediate?: boolean;
    /** 新版が有効になり本来なら再読み込みされる場面で呼ばれる（再読み込みのタイミングを自前で決める） */
    onNeedReload?: () => void;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}

/** ビルドしたコミットの先頭7文字（ローカルでは "dev"）。vite.config.ts の define */
declare const __APP_VERSION__: string;
/** 画像の実行時キャッシュ名。画像の中身が変わると変わる。vite.config.ts の define */
declare const __IMAGE_CACHE__: string;
