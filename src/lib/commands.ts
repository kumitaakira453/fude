// 操作の台帳。⌘⇧P の一覧と、設定のショートカットの面がここを見る。
//
// キーを持つ操作は、そのキーを押したのと同じ道を通す（press）。キーの処理は
// 1 か所（useHotkeys・各画面の受け口）にだけ置き、台帳は呼び出し口と名前を持つ。

export type CommandGroup = "全体" | "ワークスペース" | "ファイル" | "文書" | "タブと分割" | "右の欄";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  keys?: string;
  // 探すときに名前に足して当てる語。
  also?: string;
  run: () => void;
}

// キーの組を押したことにする。key は押した字、code は場所（⌥ を挟むと key が
// 記号になるものは code で見ている）。
export function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

const meta = (key: string, more: KeyboardEventInit = {}) => () =>
  press({ key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined, metaKey: true, ...more });

// キーを持つ操作。キーの表示は KeysPane と同じ書き方にそろえる。
export function keyedCommands(): Command[] {
  const list: Command[] = [
    { id: "sidebar", label: "サイドバーを開閉", group: "全体", keys: "⌘D", run: meta("d") },
    { id: "back", label: "戻る", group: "全体", keys: "⌘[", run: meta("[") },
    { id: "forward", label: "進む", group: "全体", keys: "⌘]", run: meta("]") },
    { id: "settings", label: "設定を開く", group: "全体", keys: "⌘,", run: meta(",") },
    { id: "keys", label: "ショートカットを見る", group: "全体", keys: "⌘/", also: "キー", run: meta("/") },
    { id: "ws.pick", label: "ワークスペースを選ぶ", group: "ワークスペース", keys: "⌘J", run: meta("j") },
    { id: "ws.new", label: "ワークスペースを作る", group: "ワークスペース", keys: "⌘T", also: "新規", run: meta("t") },
    { id: "open", label: "フォルダ・ファイルを開く", group: "ファイル", keys: "⌘O", run: meta("o") },
    { id: "memo", label: "新しいメモ", group: "ファイル", keys: "⌘N", also: "下書き", run: meta("n") },
    { id: "files", label: "ファイルを探す", group: "ファイル", keys: "⌘P", run: meta("p") },
    { id: "grep", label: "全文を検索", group: "ファイル", keys: "⌘⇧F", run: meta("f", { shiftKey: true }) },
    { id: "review", label: "コメント一覧（全ファイル）", group: "ファイル", keys: "⌘⇧R", run: meta("r", { shiftKey: true }) },
    { id: "mode", label: "閲覧と編集を切り替える", group: "文書", keys: "⌘E", also: "編集 閲覧", run: meta("e") },
    { id: "find", label: "このファイルを検索", group: "文書", keys: "⌘F", run: meta("f") },
    { id: "version.save", label: "版を保存", group: "文書", keys: "⌘S", also: "保存 バージョン", run: meta("s") },
    { id: "version.list", label: "版の履歴", group: "文書", keys: "⌘Y", also: "バージョン", run: meta("y") },
    { id: "export", label: "HTML で書き出す", group: "文書", keys: "⌘⇧E", also: "書き出し", run: meta("e", { shiftKey: true }) },
    { id: "copy", label: "全文をコピー", group: "文書", keys: "⌘⌥C", run: () => press({ key: "ç", code: "KeyC", metaKey: true, altKey: true }) },
    { id: "meta", label: "メタ情報", group: "文書", keys: "⌘⇧M", also: "フロントマター", run: meta("m", { shiftKey: true }) },
    { id: "split.right", label: "右に分割", group: "タブと分割", keys: "⌘\\", also: "分割", run: meta("\\") },
    { id: "tab.close", label: "タブを閉じる", group: "タブと分割", keys: "⌘W", run: meta("w") },
    { id: "tab.others", label: "ほかのタブを閉じる", group: "タブと分割", keys: "⌘⌥W", run: () => press({ key: "∑", code: "KeyW", metaKey: true, altKey: true }) },
    { id: "tab.all", label: "すべてのタブを閉じる", group: "タブと分割", keys: "⌘⇧W", run: () => press({ key: "W", code: "KeyW", metaKey: true, shiftKey: true }) },
    { id: "tab.reopen", label: "閉じたタブを開き直す", group: "タブと分割", keys: "⌘⇧T", run: meta("t", { shiftKey: true }) },
    { id: "toc", label: "目次を開閉", group: "右の欄", keys: "⌘⇧O", run: meta("o", { shiftKey: true }) },
    { id: "comments", label: "コメントの欄を開閉", group: "右の欄", keys: "⌘⇧K", run: meta("k", { shiftKey: true }) },
  ];
  return list;
}

// 名前で探す。空白で区切った語がすべて名前か別名に入っていれば当たり。
export function matchCommand(c: Command, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${c.label} ${c.group} ${c.also ?? ""} ${c.keys ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// 最近使った操作（新しいものが先頭）。
const RECENT_KEY = "fude:recent-commands";
export function recentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function rememberCommand(id: string): void {
  try {
    const next = [id, ...recentCommands().filter((x) => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 覚えられなくても実行はできる */
  }
}
