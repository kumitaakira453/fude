import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef } from "react";
import {
  activeFolderIdAtom,
  activePaneIdAtom,
  layoutAtom,
  savedLayoutsAtom,
  sessionLayoutsAtom,
} from "../state/atoms";

// 分割レイアウトをフォルダごとに控える（保存先はウィンドウごとに分かれている）。
// ウィンドウを問わない控えにも同じものを書く。新しいウィンドウで同じフォルダを
// 開いたときや、ウィンドウの名前が変わったときの戻り先になる。
//
// 開いているフォルダが変わったときは書かない。レイアウトはまだ前のフォルダの
// ものなので、そのまま書くと新しいフォルダの控えを前のフォルダの中身で潰す。
// 潰れた控えは「いま無いファイル」ばかりになり、戻ってきたときにタブが空になる。
export function useKeepLayout(): void {
  const store = useStore();
  const layout = useAtomValue(layoutAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  // いま持っているレイアウトが、どのフォルダのものか。
  const owner = useRef<string | null>(null);

  useEffect(() => {
    if (!activeFolderId) return;
    if (owner.current !== activeFolderId) {
      owner.current = activeFolderId;
      return;
    }
    const entry = { layout, active: activePaneId };
    store.set(savedLayoutsAtom, (prev) => ({ ...prev, [activeFolderId]: entry }));
    store.set(sessionLayoutsAtom, (prev) => ({ ...prev, [activeFolderId]: entry }));
  }, [layout, activePaneId, activeFolderId, store]);
}
