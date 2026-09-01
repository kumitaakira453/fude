import { atom, type getDefaultStore } from "jotai";

type Store = ReturnType<typeof getDefaultStore>;

// 短い知らせ。押した操作が届いたことだけを伝える用途に絞る。
// 失敗はダイアログで出す（見逃されると原因が分からなくなるため）。
// 置き場所は操作の起点で決める。右下はレビュー画面の右ペインの操作ボタンと
// 重なるので、その画面から出す知らせは中央に置く。
export type ToastPlace = "center" | "right";

// 取り消しのように、知らせから 1 回だけ実行させたい操作。
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  place: ToastPlace;
  action?: ToastAction;
}

export const toastAtom = atom<Toast | null>(null);

let seq = 0;

// 同じ文でも押すたびに出し直せるよう、id を進める。
export function notify(
  store: Store,
  text: string,
  place: ToastPlace = "center",
  action?: ToastAction,
): void {
  seq += 1;
  store.set(toastAtom, { id: seq, text, place, action });
}
