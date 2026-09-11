// トグルの開閉を、ファイルを開いているあいだだけ覚える。
//
// 初期状態は原文のタグ（`<details>` は閉じ、`<details open>` は開き）。押して
// 変えた分はここに控え、読む面と編集面で同じものを見る。塊を描き直しても、
// 別のファイルへ行って戻っても、押した通りに開く。
//
// 鍵は題の字。原文での位置は編集面では打つたびに動くので、2 面で同じ値を
// 作れない。題が同じトグルが 1 つのファイルに 2 つあると開閉を共にする。
//
// 覚えるのは記憶の上だけ。閉じ直せば原文のタグに戻る。

const folds = new Map<string, boolean>();

export function foldKey(path: string | null, title: string): string | null {
  return path ? `${path} ${title.trim()}` : null;
}

export function recallFold(key: string | null, or: boolean): boolean {
  if (!key) return or;
  const was = folds.get(key);
  return was ?? or;
}

export function rememberFold(key: string | null, open: boolean): void {
  if (!key) return;
  folds.set(key, open);
}

export function forgetFolds(): void {
  folds.clear();
}
