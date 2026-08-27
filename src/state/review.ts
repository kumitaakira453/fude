import { atom, type getDefaultStore } from "jotai";
import { EMPTY_LEDGER, isOpen, loadLedger, type Ledger } from "../lib/review";
import { activeFolderIdAtom } from "./atoms";

type Store = ReturnType<typeof getDefaultStore>;

// レビューの台帳。CLI からも書き換わるため、フォーカスが戻ったときと
// 自分が書き込んだ直後に読み直す。
export const ledgerAtom = atom<Ledger>(EMPTY_LEDGER);

// 未解決件数を、開いているフォルダからの相対パスで引けるようにする。
// 台帳は絶対パスで持つが、ファイルツリーが扱うのは相対パスなのでここで揃える。
export const openCountsAtom = atom((get) => {
  const root = get(activeFolderIdAtom);
  const counts = new Map<string, number>();
  if (!root) return counts;
  const prefix = `${root}/`;
  for (const thread of get(ledgerAtom).threads) {
    if (!isOpen(thread) || !thread.file.startsWith(prefix)) continue;
    const rel = thread.file.slice(prefix.length);
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
});

// レビュー画面の開閉と、そこで選択している指摘。
export const reviewScreenAtom = atom(false);
export const reviewThreadAtom = atom<string | null>(null);

// 未解決の総数。ツールバーの入口に出す。
export const openTotalAtom = atom(
  (get) => get(ledgerAtom).threads.filter(isOpen).length,
);

export async function refreshLedger(store: Store): Promise<void> {
  store.set(ledgerAtom, await loadLedger());
}
