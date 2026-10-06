import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// ワークスペースの列（タブの上に横一列で並べるもの）。
//
// ブラウザのタブと同じ考え方で、開いたワークスペースが末尾に入り、× で列から
// 外す（ワークスペースそのものは消さない）。並びは全ウィンドウで共有する。
// ⌘1〜9 はこの並びの位置を指す。
export const barAtom = atomWithStorage<string[]>("fude:wsbar", [], undefined, {
  getOnInit: true,
});

// ⌘ を押したままにしているあいだ、札に ⌘1〜9 の番号を出す。
export const hintsAtom = atom(false);

// ⌘J の一覧を開く頼み（札の並びの ▾ から）。
export const cyclerAskAtom = atom(0);

// このウィンドウで開いた順（新しいものが先頭）。⌃Tab で直前のものへ戻るのに使う。
export const visitedAtom = atom<string[]>([]);

// 末尾に入れる。既にあれば動かさない（並びが勝手に変わると番号が狂う）。
export function addToBar(list: readonly string[], id: string): string[] {
  return list.includes(id) ? [...list] : [...list, id];
}

export function removeFromBar(list: readonly string[], id: string): string[] {
  return list.filter((x) => x !== id);
}

// id を to の位置へ動かす（to は動かす前の並びでの差し込み位置）。
export function moveInBar(list: readonly string[], id: string, to: number): string[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const rest = list.filter((x) => x !== id);
  const at = Math.max(0, Math.min(from < to ? to - 1 : to, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function visit(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)];
}

// ⌘1〜9 の行き先。9 は最後。
export function barTarget(list: readonly string[], n: number): string | undefined {
  if (list.length === 0) return undefined;
  return n === 9 ? list[list.length - 1] : list[n - 1];
}
