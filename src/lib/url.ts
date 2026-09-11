// URL ハッシュに「開いているフォルダ ID とファイルパス」を反映する。
// 静的ホスティングでも問題ないよう hash を使う。

export interface UrlState {
  folderId?: string;
  file?: string;
  // そのファイルだけを出す窓として開かれたか。追加ウィンドウの起動 URL に
  // だけ載る。控えのレイアウト（他のウィンドウで開いていたタブ）を並べ直すと
  // 窓を複製しただけになるので、それを止めるための印。
  only?: boolean;
  // フォルダを開かずに 1 枚だけ開いているときの、そのファイルの絶対パス。
  // folder と file の組とは別の道（親フォルダは履歴に登録しない）。
  doc?: string;
}

// ハッシュを読む。追加ウィンドウの起動 URL はここを経由して復元されるため、
// フラグメントが落ちる経路に備えてクエリ文字列も見る。
export function parseHash(): UrlState {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  const pick = (key: string) => hash.get(key) ?? query.get(key) ?? undefined;
  return {
    folderId: pick("folder"),
    file: pick("file"),
    only: pick("only") === "1",
    doc: pick("doc"),
  };
}

export function buildHash(
  folderId?: string | null,
  file?: string | null,
  only = false,
  doc?: string | null,
): string {
  const p = new URLSearchParams();
  // 1 枚で開いているときはそれだけを載せる。親フォルダは履歴に登録しないので、
  // folder として書いても開き直せない。
  if (doc) p.set("doc", doc);
  else {
    if (folderId) p.set("folder", folderId);
    if (only) p.set("only", "1");
  }
  if (file) p.set("file", file);
  const s = p.toString();
  return s ? `#${s}` : "#";
}
