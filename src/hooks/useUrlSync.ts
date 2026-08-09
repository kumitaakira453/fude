import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import * as A from "../state/atoms";
import { buildHash, parseHash } from "../lib/url";
import { useWorkspace } from "./useWorkspace";

// URL(hash) と「開いているフォルダ・ファイル」を双方向同期する。
// - マウント時: 履歴読込後、URL のフォルダを権限 granted なら無確認で復元
// - 状態変化時: pushState で履歴を積む（ブラウザバック対応）
// - popstate: URL を解釈して状態へ反映（権限が無ければスタート画面へ）
export function useUrlSync() {
  const store = useStore();
  const { refreshFolders, openFolder, openFile } = useWorkspace();
  const activeFolderId = useAtomValue(A.activeFolderIdAtom);
  const activePane = useAtomValue(A.activePaneAtom);
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
    async (state: { folderId?: string; file?: string }, opts: { force?: boolean } = {}) => {
      applyingRef.current = true;
      try {
        const { folderId, file } = state;
        if (!folderId) {
          store.set(A.activeFolderIdAtom, null);
          return;
        }
        const entry = store.get(A.foldersAtom).find((f) => f.id === folderId);
        if (!entry) {
          store.set(A.activeFolderIdAtom, null);
          return;
        }
        if (store.get(A.activeFolderIdAtom) !== folderId) {
          await openFolder(entry.path);
        }
        // 初期復元では保存レイアウトのファイルを尊重（上書きしない）。
        // 戻る/進む(popstate)では force で必ず切り替える。
        if (file && (opts.force || !store.get(A.activePaneAtom)?.path)) openFile(file);
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
      if (state.folderId) await applyUrl.current(state);
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
      const st = e.state as { mdglowIdx?: number } | null;
      navIdx.current = typeof st?.mdglowIdx === "number" ? st.mdglowIdx : 0;
      updateNav.current();
      void applyUrl.current(parseHash(), { force: true });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 状態変化を URL へ反映
  useEffect(() => {
    if (!readyRef.current || applyingRef.current) return;
    const desired = buildHash(activeFolderId, activePane?.path);
    if (location.hash !== desired && !(location.hash === "" && desired === "#")) {
      navIdx.current += 1;
      navMax.current = navIdx.current;
      history.pushState({ mdglowIdx: navIdx.current }, "", desired);
      updateNav.current();
    }
  }, [activeFolderId, activePane?.path]);
}
