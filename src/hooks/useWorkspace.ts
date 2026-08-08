import { useCallback } from "react";
import { useStore } from "jotai";
import * as A from "../state/atoms";
import { buildTree, flattenFiles, readFile, type TreeNode } from "../lib/fsAccess";
import { registerFolder, loadFolders } from "../lib/idb";
import { assetKey, getCachedAsset, setCachedAsset } from "../lib/assetCache";
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

  const getRootHandle = useCallback((): FileSystemDirectoryHandle | null => {
    const id = store.get(A.activeFolderIdAtom);
    const folders = store.get(A.foldersAtom);
    return folders.find((f) => f.id === id)?.handle ?? null;
  }, [store]);

  const getFileNode = useCallback(
    (path: string): TreeNode | null => {
      return store.get(A.filesAtom).find((f) => f.path === path) ?? null;
    },
    [store],
  );

  // 全 md を読み込み、全文検索インデックス（= 生テキストのキャッシュ）を構築する。
  const indexContents = useCallback(
    async (files: TreeNode[]) => {
      const content = new Map<string, string>();
      const mtime = new Map<string, number>();
      const total = files.length;
      store.set(A.loadingAtom, { active: true, message: "インデックス構築中", done: 0, total });
      for (let i = 0; i < files.length; i++) {
        const node = files[i];
        try {
          const data = await readFile(node.handle as FileSystemFileHandle);
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
    const root = getRootHandle();
    if (!root) return;
    const tree = await buildTree(root);
    const files = flattenFiles(tree);
    store.set(A.treeAtom, tree);
    store.set(A.filesAtom, files);
    await indexContents(files);
  }, [store, getRootHandle, indexContents]);

  const refreshFolders = useCallback(async () => {
    store.set(A.foldersAtom, await loadFolders());
  }, [store]);

  const openFolder = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      const now = performance.timeOrigin + performance.now();
      const folders = await registerFolder(handle, Math.floor(now));
      store.set(A.foldersAtom, folders);
      let activeId = folders[0]?.id ?? null;
      for (const f of folders) {
        if (await f.handle.isSameEntry(handle)) {
          activeId = f.id;
          break;
        }
      }
      // 永続化 effect に上書きされる前に保存レイアウトを先読みしておく
      const saved = activeId ? store.get(A.savedLayoutsAtom)[activeId] : undefined;
      store.set(A.activeFolderIdAtom, activeId);
      resetLayout(store);
      await refreshTree();
      // 保存済みの分割レイアウトがあれば復元（存在しないパスは空ペインに）
      if (saved) {
        const valid = new Set(store.get(A.filesAtom).map((f) => f.path));
        const { layout, active } = reviveLayout(saved.layout, valid, saved.active);
        store.set(A.layoutAtom, layout);
        store.set(A.activePaneIdAtom, active);
      }
    },
    [store, refreshTree],
  );

  // 単一ファイルの再読込（ファイル監視で変更検知したとき）。
  const reloadFile = useCallback(
    async (path: string) => {
      const node = getFileNode(path);
      if (!node) return;
      try {
        const data = await readFile(node.handle as FileSystemFileHandle);
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
      // 未キャッシュならその場で読み込む
      if (!store.get(A.contentCacheAtom).has(path)) void reloadFile(path);
    },
    [store, reloadFile],
  );

  // ドキュメント内の相対リンク（.md）を辿る。
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

  // 相対パス資産（画像など）を解決済み object URL のキャッシュから同期取得する。
  const peekAsset = useCallback(
    (fromDocPath: string, src: string): string | null => {
      const root = getRootHandle();
      if (!root) return null;
      const full = resolvePath(dirOf(fromDocPath), src);
      return getCachedAsset(assetKey(root.name, full)) ?? null;
    },
    [getRootHandle],
  );

  // 相対パス資産（画像など）をローカル FS から解決して object URL を返す。
  // 一度作った URL はキャッシュして revoke しない（ちらつき・消失防止）。
  const resolveAsset = useCallback(
    async (fromDocPath: string, src: string): Promise<string | null> => {
      const root = getRootHandle();
      if (!root) return null;
      const full = resolvePath(dirOf(fromDocPath), src);
      const key = assetKey(root.name, full);
      const cached = getCachedAsset(key);
      if (cached) return cached;
      const segs = full.split("/").filter(Boolean);
      if (segs.length === 0) return null;
      try {
        let dir = root;
        for (let i = 0; i < segs.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segs[i]);
        }
        const fileHandle = await dir.getFileHandle(segs[segs.length - 1]);
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        setCachedAsset(key, url);
        return url;
      } catch {
        return null;
      }
    },
    [getRootHandle],
  );

  return {
    getRootHandle,
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
