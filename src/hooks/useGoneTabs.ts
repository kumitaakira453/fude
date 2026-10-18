import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { pathExists } from "../lib/fsAccess";
import * as A from "../state/atoms";

// 開いているタブのうち、消えた・見張っているフォルダの外へ移されたファイル。
//
// 木を読み直すたびに見直す。木に無いタブだけを実物で確かめ、無ければ印を付ける。
// 木に戻ってきたもの（元に戻した・同じ名前で作り直した）は印を外す。fude の中で
// 名前を変えたものはタブが新しい道筋へ付け替わるので、印は付かない。
export async function goneAmong(
  tabs: readonly string[],
  known: ReadonlySet<string>,
  exists: (path: string) => Promise<boolean>,
): Promise<Set<string>> {
  const doubtful = tabs.filter((p) => !known.has(p));
  const there = await Promise.all(doubtful.map((p) => exists(p).catch(() => true)));
  return new Set(doubtful.filter((_, i) => !there[i]));
}

export function useGoneTabs() {
  const files = useAtomValue(A.filesAtom);
  const panes = useAtomValue(A.panesAtom);
  const setGone = useSetAtom(A.goneTabsAtom);
  const tabsKey = JSON.stringify(panes.map((p) => p.tabs));

  useEffect(() => {
    // 木を組み直している間（空）は見ない。全部のタブを確かめに行くことになる。
    if (files.length === 0) return;
    const tabs = [...new Set(panes.flatMap((p) => p.tabs))];
    const known = new Set(files.map((f) => f.path));
    let live = true;
    void goneAmong(tabs, known, pathExists).then((gone) => {
      if (!live) return;
      setGone((was) => (sameSet(was, gone) ? was : gone));
    });
    return () => {
      live = false;
    };
    // panes は中身（タブの並び）で見る。並びが同じなら確かめ直さない。
  }, [files, tabsKey, setGone]);
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));
