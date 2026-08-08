import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "jotai";
import App from "./App";
import "material-symbols/rounded.css";
import "katex/dist/katex.min.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider>
      <App />
    </Provider>
  </StrictMode>,
);

// PWA: Service Worker 登録（インストール可能化 → 権限の永続化）
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ストレージの eviction を抑止し、ディレクトリハンドルと権限を消えにくくする
if (navigator.storage?.persist) {
  navigator.storage.persisted().then((p) => {
    if (!p) void navigator.storage.persist();
  });
}
