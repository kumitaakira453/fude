// URL ハッシュに「開いているフォルダ ID とファイルパス」を反映する。
// 静的ホスティングでも問題ないよう hash を使う。

export interface UrlState {
  folderId?: string;
  file?: string;
}

// ハッシュを読む。追加ウィンドウの起動 URL はここを経由して復元されるため、
// フラグメントが落ちる経路に備えてクエリ文字列も見る。
export function parseHash(): UrlState {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  const pick = (key: string) => hash.get(key) ?? query.get(key) ?? undefined;
  return { folderId: pick("folder"), file: pick("file") };
}

export function buildHash(folderId?: string | null, file?: string | null): string {
  const p = new URLSearchParams();
  if (folderId) p.set("folder", folderId);
  if (file) p.set("file", file);
  const s = p.toString();
  return s ? `#${s}` : "#";
}
