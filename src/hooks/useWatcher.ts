import { watch, type UnwatchFn, type WatchEvent } from "@tauri-apps/plugin-fs";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { invalidateImage, isImage, isMarkdown } from "../lib/fsAccess";
import { kindOf } from "../lib/kind";
import { matchRenames, newRenameMemo } from "../lib/renames";
import * as A from "../state/atoms";
import { useWorkspace } from "./useWorkspace";

// 監視の合図の読み方。notify の種別はそのまま届くので、名前の変更と消滅は
// 当てずっぽうではなく合図で分かる。
const modifyOf = (event: WatchEvent) => {
  const kind = event.type;
  return typeof kind === "object" && "modify" in kind ? kind.modify : null;
};

// 古い名前と新しい名前がまとめて届いたときの組。
function renamedPair(event: WatchEvent, root: string): [string, string] | null {
  const mod = modifyOf(event);
  if (!mod || mod.kind !== "rename" || mod.mode !== "both") return null;
  if (event.paths.length !== 2) return null;
  const [from, to] = event.paths;
  if (!from.startsWith(root) || !to.startsWith(root)) return null;
  // 本文かフォルダのときだけ。画像などの付け替えは開いているタブに関わらない。
  if (!isMarkdown(to) && /\.[a-z0-9]+$/i.test(to)) return null;
  return [from.slice(root.length + 1), to.slice(root.length + 1)];
}

// そのパスが消えた合図か（消滅、または名前の変更の「古い方」）。
function vanished(event: WatchEvent): boolean {
  const kind = event.type;
  if (typeof kind === "object" && "remove" in kind) return true;
  const mod = modifyOf(event);
  return mod?.kind === "rename" && mod.mode === "from";
}

// Tauri の OS ネイティブ file watcher でアクティブフォルダを監視し、変更を即反映する。
export function useWatcher() {
  const store = useStore();
  const activeFolderId = useAtomValue(A.activeFolderIdAtom);
  const { getRootPath, reloadFile, refreshTreeStructure, adoptRename } = useWorkspace();

  useEffect(() => {
    const root = getRootPath();
    if (!root) return;

    let disposed = false;
    let unwatch: UnwatchFn | null = null;
    let treeTimer: number | undefined;
    // 名前の変更は届き方が一定しない。両方まとめて届くこともあれば、
    // 「古い名前が消えた」「新しい名前が現れた」が別々の回に届くこともある。
    // 組めなかった片割れは覚え書きに残し、次の回の相手と突き合わせる。
    const memo = newRenameMemo();
    const scheduleTreeRefresh = () => {
      window.clearTimeout(treeTimer);
      treeTimer = window.setTimeout(() => {
        if (disposed) return;
        const before = store.get(A.filesAtom).map((f) => f.path);
        void refreshTreeStructure().then(() => {
          if (disposed) return;
          const after = new Set(store.get(A.filesAtom).map((f) => f.path));
          const pairs = matchRenames(memo, {
            missing: before.filter((p) => !after.has(p)),
            born: [...after].filter((p) => !before.includes(p)),
            present: after,
            now: Date.now(),
          });
          for (const [from, to] of pairs) void adoptRename(from, to);
        });
      }, 400);
    };

    watch(
      root,
      (event) => {
        if (disposed) return;
        // 名前の変更として届いたなら、当てずっぽうに頼らずそのまま組める。
        const both = renamedPair(event, root);
        if (both) {
          void adoptRename(both[0], both[1]);
          scheduleTreeRefresh();
          return;
        }
        // 1 枚だけ開いているときは、その 1 枚に当たる合図だけを通す。
        // 親フォルダには他のファイルがいくらでもあり、それで木を組み直しても
        // 出すものは変わらない。
        const sole = store.get(A.soleAtom);
        if (sole && !event.paths.includes(sole)) return;
        const known = new Set(store.get(A.filesAtom).map((f) => f.path));
        const shown = store.get(A.showOtherFilesAtom);
        const touched = new Map(store.get(A.touchedAtom));
        const gone = vanished(event);
        let structural = false;
        let assetChanged = false;
        for (const abs of event.paths) {
          if (!abs.startsWith(root)) continue;
          const rel = abs.slice(root.length + 1);
          if (isMarkdown(rel)) {
            // 触られた時刻を今にしておく。クイックオープンの並び順が、
            // 外から書き換わった分（エージェントの編集など）も追いかける。
            touched.set(rel, Date.now());
            // 消えた合図なら読み直しても意味が無い。木を取り直して、
            // 現れた名前と組にできるか見る。
            if (!gone && known.has(rel)) void reloadFile(rel);
            else structural = true;
          } else if (kindOf(rel) !== "other") {
            // 画像はキャッシュを捨てて取り直させる。HTML と PDF は描いている
            // 器が中身を抱えているので、版を上げて貼り直す。
            if (isImage(rel)) invalidateImage(abs);
            assetChanged = true;
            // 一覧に並べているのに木がまだ知らない名前なら、並べ直す。
            if (shown && (gone || !known.has(rel))) structural = true;
          } else {
            structural = true; // ディレクトリ変化など
          }
        }
        store.set(A.touchedAtom, touched);
        if (assetChanged) {
          store.set(A.assetVersionAtom, store.get(A.assetVersionAtom) + 1);
        }
        if (structural) scheduleTreeRefresh();
      },
      // 1 枚だけ開いているときは下の階層まで見張らない。見るのはその 1 枚で、
      // 親が ~/Downloads のような大きなフォルダだと丸ごと見張る意味が無い。
      { recursive: !store.get(A.soleAtom), delayMs: 250 },
    )
      .then((fn) => {
        if (disposed) fn();
        else {
          unwatch = fn;
          store.set(A.watchModeAtom, "observer");
        }
      })
      .catch(() => {
        store.set(A.watchModeAtom, "off");
      });

    return () => {
      disposed = true;
      window.clearTimeout(treeTimer);
      unwatch?.();
      store.set(A.watchModeAtom, "off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId]);
}
