import { Provider } from "jotai";
import "katex/dist/katex.min.css";
import "material-symbols/rounded.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// ページ読み込み回数を計測（ホワイトアウト＝リロードかどうかの切り分け用）
try {
  const n = Number(sessionStorage.getItem("mdglow:loads") ?? "0") + 1;
  sessionStorage.setItem("mdglow:loads", String(n));
} catch {
  /* noop */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider>
        <App />
      </Provider>
    </ErrorBoundary>
  </StrictMode>,
);
