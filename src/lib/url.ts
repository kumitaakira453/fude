// URL ハッシュに「開いているフォルダ ID とファイルパス」を反映する。
// 静的ホスティングでも問題ないよう hash を使う。

export interface UrlState {
  folderId?: string;
  file?: string;
}

export function parseHash(): UrlState {
  const raw = location.hash.replace(/^#/, "");
  const p = new URLSearchParams(raw);
  return {
    folderId: p.get("folder") ?? undefined,
    file: p.get("file") ?? undefined,
  };
}

export function buildHash(folderId?: string | null, file?: string | null): string {
  const p = new URLSearchParams();
  if (folderId) p.set("folder", folderId);
  if (file) p.set("file", file);
  const s = p.toString();
  return s ? `#${s}` : "#";
}
