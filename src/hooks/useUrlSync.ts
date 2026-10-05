import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef } from "react";
import { dropBootCurtain, whenDocShown } from "../lib/boot";
import { absoluteIn } from "../lib/fsAccess";
import { buildHash, parseHash, type UrlState } from "../lib/url";
import { currentWindowLabel, MAIN_LABEL, openWorkspaceWindow } from "../lib/windows";
import { takeRestore, type Workspace } from "../lib/workspaces";
import { refreshWorkspaces } from "../state/workspace";
import * as A from "../state/atoms";
import { useWorkspace, whenOpened } from "./useWorkspace";

// URL(hash) と「開いているフォルダ・ファイル」を双方向同期する。
// - マウント時: 履歴読込後、URL のフォルダを権限 granted なら無確認で復元
// - 状態変化時: pushState で履歴を積む（ブラウザバック対応）
// - popstate: URL を解釈して状態へ反映（権限が無ければスタート画面へ）
// 起動の幕を残しておく上限（ms）。
const CURTAIN_WAIT = 3000;

export function useUrlSync() {
  const store = useStore();
  const { refreshFolders, openFolder, openWorkspace, openDoc, openFile, holdDraft } =
    useWorkspace();
  const wsId = useAtomValue(A.workspaceAtom)?.id ?? null;
  // 引き止める道具。効果の中から呼ぶので控えで持つ。
  const hold = useRef(holdDraft);
  hold.current = holdDraft;
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

  // 控えのワークスペース。一覧に無ければ読み直してから探す（他の窓で作ったもの）。
  const findWorkspace = async (id: string): Promise<Workspace | undefined> => {
    const known = store.get(A.workspacesAtom).find((w) => w.id === id);
    if (known) return known;
    await refreshWorkspaces(store);
    return store.get(A.workspacesAtom).find((w) => w.id === id);
  };

  const applyUrl = useRef(
    async (
      state: UrlState,
      opts: { force?: boolean } = {},
    ) => {
      applyingRef.current = true;
      try {
        const { folderId, file, only, doc, ws } = state;
        // 1 枚だけの窓。親フォルダは履歴に無いので、フォルダの枝には乗せない。
        if (doc) {
          if (store.get(A.soleAtom) !== doc) await openDoc(doc);
          return;
        }
        // ワークスペースの窓。消されていたら、フォルダの道へ落ちる（無ければスタート画面）。
        if (ws) {
          const found = await findWorkspace(ws);
          if (found) {
            const target = file ? absoluteIn(file, found.roots[0]) : undefined;
            if (store.get(A.workspaceAtom)?.id !== ws) {
              await openWorkspace(found, { file: target });
            } else if (target && opts.force) {
              openFile(target);
            }
            return;
          }
        }
        if (!folderId) {
          // 下書きを開いたまま起動画面へ戻らない。行き先を決めてから。
          if (hold.current(() => applyUrl.current(state, opts))) return;
          store.set(A.activeFolderIdAtom, null);
          store.set(A.soleAtom, null);
          return;
        }
        const entry = store.get(A.foldersAtom).find((f) => f.id === folderId);
        if (!entry) {
          store.set(A.activeFolderIdAtom, null);
          return;
        }
        // ファイルは絶対パスで載せる。根からの相対で載っていた頃の URL も読む。
        const target = file ? absoluteIn(file, entry.path) : undefined;
        if (store.get(A.activeFolderIdAtom) !== folderId) {
          // 開くファイルが決まっているなら、ツリーの走査より先に出させる
          // only は「そのファイルだけの窓」として開かれた印。控えの
          // レイアウトを並べ直さず、頼まれたファイルだけを出す。
          await openFolder(entry.path, { file: target, only });
        }
        // 初期復元では保存レイアウトのファイルを尊重（上書きしない）。
        // 戻る/進む(popstate)では force で必ず切り替える。
        if (target && (opts.force || !A.activePath(store.get(A.activePaneAtom))))
          openFile(target);
      } finally {
        applyingRef.current = false;
      }
    },
  );

  // 初期復元（この完了までは URL 書き込みを行わない）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 復元対象のハッシュを、書き込み effect に潰される前に確定させておく
        const state = parseHash();
        await refreshFolders();
        if (cancelled) return;
        const restore =
          state.folderId || state.doc || state.ws || currentWindowLabel() !== MAIN_LABEL
            ? []
            : await takeRestore().catch(() => []);
        if (cancelled) return;
        if (state.folderId || state.doc || state.ws) {
          await applyUrl.current(state);
        } else if (restore.length > 0) {
          // 終了したときに開いていた窓を戻す。主窓は自分の分を開き、
          // 残りは窓を作って開かせる。
          const [mine, ...rest] = restore;
          for (const [, id] of rest) {
            const ws = await findWorkspace(id);
            if (ws) void openWorkspaceWindow(ws.id, ws.name).catch(() => {});
          }
          const ws = await findWorkspace(mine[1]);
          if (ws) await openWorkspace(ws);
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
        // 木とタブが並び、開いていた本文が描けるまで幕を残す。大きなフォルダで
        // 走査が長引いても、幕の裏で待たせ続けはしない。
        const settled = (async () => {
          await whenOpened();
          if (A.activePath(store.get(A.activePaneAtom))) await whenDocShown();
        })();
        await Promise.race([settled, new Promise((r) => setTimeout(r, CURTAIN_WAIT))]);
      } finally {
        if (!cancelled) dropBootCurtain();
      }
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
    const desired = buildHash(activeFolderId, activeFile, false, sole, wsId);
    if (
      location.hash !== desired &&
      !(location.hash === "" && desired === "#")
    ) {
      navIdx.current += 1;
      navMax.current = navIdx.current;
      history.pushState({ fudeIdx: navIdx.current }, "", desired);
      updateNav.current();
    }
  }, [activeFolderId, activeFile, sole, wsId]);
}
