import { useCallback } from "react";
import { useStore } from "jotai";
import * as A from "../state/atoms";
import { buildTree, flattenFiles, readFile, assetUrl, type TreeNode } from "../lib/fsAccess";
import { registerFolder, loadFolders } from "../lib/idb";
import { resetLayout, reviveLayout, setPanePath } from "../lib/ui";

// path 正規化（. / .. を解決）。
function resolvePath(baseDir: string, rel: string): string {
  const cleanRel = rel.split("#")[0].split("?")[0];
  const stack = baseDir ? baseDir.split("/") : [];
  for (const seg of cleanRel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function useWorkspace() {
  const store = useStore();

  const getRootPath = useCallback((): string | null => {
    const id = store.get(A.activeFolderIdAtom);
    const folders = store.get(A.foldersAtom);
    return folders.find((f) => f.id === id)?.path ?? null;
  }, [store]);

  const getFileNode = useCallback(
    (path: string): TreeNode | null => {
      return store.get(A.filesAtom).find((f) => f.path === path) ?? null;
    },
    [store],
  );

  // 全 md を読み込み、全文検索インデックス（生テキストのキャッシュ）を構築する。
  const indexContents = useCallback(
    async (files: TreeNode[]) => {
      const content = new Map<string, string>();
      const mtime = new Map<string, number>();
      const total = files.length;
      store.set(A.loadingAtom, { active: true, message: "インデックス構築中", done: 0, total });
      for (let i = 0; i < files.length; i++) {
        const node = files[i];
        try {
          const data = await readFile(node.abs);
          content.set(node.path, data.text);
          mtime.set(node.path, data.lastModified);
        } catch {
          /* 読み込めないファイルはスキップ */
        }
        if (i % 20 === 0) {
          store.set(A.loadingAtom, { active: true, message: "インデックス構築中", done: i, total });
        }
      }
      store.set(A.contentCacheAtom, content);
      store.set(A.mtimeCacheAtom, mtime);
      store.set(A.loadingAtom, { active: false, message: "", done: total, total });
    },
    [store],
  );

  const refreshTree = useCallback(async () => {
    const root = getRootPath();
    if (!root) return;
    const tree = await buildTree(root);
    const files = flattenFiles(tree);
    store.set(A.treeAtom, tree);
    store.set(A.filesAtom, files);
    await indexContents(files);
  }, [store, getRootPath, indexContents]);

  const refreshFolders = useCallback(async () => {
    store.set(A.foldersAtom, await loadFolders());
  }, [store]);

  const openFolder = useCallback(
    async (path: string) => {
      const now = Math.floor(performance.timeOrigin + performance.now());
      const folders = await registerFolder(path, now);
      store.set(A.foldersAtom, folders);
      const activeId = path;
      // 永続化 effect に上書きされる前に保存レイアウトを先読みしておく
      const saved = store.get(A.savedLayoutsAtom)[activeId];
      store.set(A.activeFolderIdAtom, activeId);
      resetLayout(store);
      await refreshTree();
      if (saved) {
        const valid = new Set(store.get(A.filesAtom).map((f) => f.path));
        const { layout, active } = reviveLayout(saved.layout, valid, saved.active);
        store.set(A.layoutAtom, layout);
        store.set(A.activePaneIdAtom, active);
      }
    },
    [store, refreshTree],
  );

  const reloadFile = useCallback(
    async (path: string) => {
      const node = getFileNode(path);
      if (!node) return;
      try {
        const data = await readFile(node.abs);
        const content = new Map(store.get(A.contentCacheAtom));
        const mtime = new Map(store.get(A.mtimeCacheAtom));
        content.set(path, data.text);
        mtime.set(path, data.lastModified);
        store.set(A.contentCacheAtom, content);
        store.set(A.mtimeCacheAtom, mtime);
      } catch {
        /* noop */
      }
    },
    [store, getFileNode],
  );

  const openFile = useCallback(
    (path: string, paneId?: string) => {
      const targetPane = paneId ?? store.get(A.activePaneIdAtom);
      setPanePath(store, targetPane, path);
      store.set(A.activePaneIdAtom, targetPane);
      if (!store.get(A.contentCacheAtom).has(path)) void reloadFile(path);
    },
    [store, reloadFile],
  );

  const navigate = useCallback(
    (fromDocPath: string, href: string) => {
      let target = resolvePath(dirOf(fromDocPath), href);
      if (!store.get(A.filesAtom).some((f) => f.path === target) && !/\.[a-z]+$/i.test(target)) {
        target = `${target}.md`;
      }
      if (store.get(A.filesAtom).some((f) => f.path === target)) openFile(target);
    },
    [store, openFile],
  );

  // 相対パス資産（画像など）を webview 表示用 URL に変換する（同期）。
  const peekAsset = useCallback(
    (fromDocPath: string, src: string): string | null => {
      const root = getRootPath();
      if (!root) return null;
      const full = resolvePath(dirOf(fromDocPath), src);
      if (!full) return null;
      return assetUrl(`${root}/${full}`);
    },
    [getRootPath],
  );

  const resolveAsset = useCallback(
    async (fromDocPath: string, src: string): Promise<string | null> => peekAsset(fromDocPath, src),
    [peekAsset],
  );

  return {
    getRootPath,
    refreshFolders,
    openFolder,
    refreshTree,
    reloadFile,
    openFile,
    navigate,
    resolveAsset,
    peekAsset,
  };
}
