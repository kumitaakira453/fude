import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef } from "react";
import { buildHash, parseHash } from "../lib/url";
import * as A from "../state/atoms";
import { useWorkspace } from "./useWorkspace";

// URL(hash) と「開いているフォルダ・ファイル」を双方向同期する。
// - マウント時: 履歴読込後、URL のフォルダを権限 granted なら無確認で復元
// - 状態変化時: pushState で履歴を積む（ブラウザバック対応）
// - popstate: URL を解釈して状態へ反映（権限が無ければスタート画面へ）
export function useUrlSync() {
  const store = useStore();
  const { refreshFolders, openFolder, openDoc, openFile } = useWorkspace();
  const activeFolderId = useAtomValue(A.activeFolderIdAtom);
  const sole = useAtomValue(A.soleAtom);
  const activePane = useAtomValue(A.activePaneAtom);
  const activeFile = A.activePath(activePane);
  const applyingRef = useRef(false);
  // 初期復元が完了するまで URL 書き込みを止める（マウント時のハッシュ上書き=クロバー防止）
  const readyRef = useRef(false);
  // 戻る/進むの可否判定用に自前でナビゲーション位置を追跡
  const navIdx = useRef(0);
  const navMax = useRef(0);
  const updateNav = useRef(() => {
    store.set(A.canBackAtom, navIdx.current > 0);
    store.set(A.canForwardAtom, navIdx.current < navMax.current);
  });

  const applyUrl = useRef(
    async (
      state: { folderId?: string; file?: string; only?: boolean; doc?: string },
      opts: { force?: boolean } = {},
    ) => {
      applyingRef.current = true;
      try {
        const { folderId, file, only, doc } = state;
        // 1 枚だけの窓。親フォルダは履歴に無いので、フォルダの枝には乗せない。
        if (doc) {
          if (store.get(A.soleAtom) !== doc) await openDoc(doc);
          return;
        }
        if (!folderId) {
          store.set(A.activeFolderIdAtom, null);
          store.set(A.soleAtom, null);
          return;
        }
        const entry = store.get(A.foldersAtom).find((f) => f.id === folderId);
        if (!entry) {
          store.set(A.activeFolderIdAtom, null);
          return;
        }
        if (store.get(A.activeFolderIdAtom) !== folderId) {
          // 開くファイルが決まっているなら、ツリーの走査より先に出させる
          // only は「そのファイルだけの窓」として開かれた印。控えの
          // レイアウトを並べ直さず、頼まれたファイルだけを出す。
          await openFolder(entry.path, { file, only });
        }
        // 初期復元では保存レイアウトのファイルを尊重（上書きしない）。
        // 戻る/進む(popstate)では force で必ず切り替える。
        if (file && (opts.force || !A.activePath(store.get(A.activePaneAtom))))
          openFile(file);
      } finally {
        applyingRef.current = false;
      }
    },
  );

  // 初期復元（この完了までは URL 書き込みを行わない）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 復元対象のハッシュを、書き込み effect に潰される前に確定させておく
      const state = parseHash();
      await refreshFolders();
      if (cancelled) return;
      if (state.folderId || state.doc) {
        await applyUrl.current(state);
      } else {
        // 起動直後は最後に開いていたものへ戻す。フォルダと 1 枚のファイルの
        // どちらもありうるので、時刻の新しいほうを選ぶ。どちらの履歴も
        // 新しい順なので、比べるのは先頭どうしでよい。
        const folder = store.get(A.foldersAtom)[0];
        const doc = store.get(A.recentDocsAtom)[0];
        if (doc && (!folder || doc.lastOpened > folder.lastOpened))
          await openDoc(doc.path);
        else if (folder) await openFolder(folder.path);
      }
      readyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // popstate（ブラウザの戻る/進む）
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { fudeIdx?: number } | null;
      navIdx.current = typeof st?.fudeIdx === "number" ? st.fudeIdx : 0;
      updateNav.current();
      void applyUrl.current(parseHash(), { force: true });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 状態変化を URL へ反映
  useEffect(() => {
    if (!readyRef.current || applyingRef.current) return;
    const desired = buildHash(activeFolderId, activeFile, false, sole);
    if (
      location.hash !== desired &&
      !(location.hash === "" && desired === "#")
    ) {
      navIdx.current += 1;
      navMax.current = navIdx.current;
      history.pushState({ fudeIdx: navIdx.current }, "", desired);
      updateNav.current();
    }
  }, [activeFolderId, activeFile, sole]);
}
