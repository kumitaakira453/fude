import { createContext } from "react";

export interface MarkdownCtx {
  // ドキュメント内リンク（相対 .md）クリック時のナビゲーション
  onNavigate: (targetPath: string) => void;
  // 相対パス画像などをローカル FS から解決して object URL を返す
  resolveAsset: (src: string) => Promise<string | null>;
  // キャッシュ済み object URL を同期取得（再マウント時のちらつき防止）
  peekAsset: (src: string) => string | null;
  // 現在描画中ドキュメントのパス（相対解決の基準）
  docPath: string;
}

export const markdownContext = createContext<MarkdownCtx | null>(null);
