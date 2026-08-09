import { useStore } from "jotai";
import { useCallback } from "react";
import {
  buildTree,
  createDir,
  flattenFiles,
  imageUrl,
  isMarkdown,
  pathExists,
  peekImageUrl,
  readFile,
  removePath,
  renamePath,
  writeFile,
  type TreeNode,
} from "../lib/fsAccess";
import { loadFolders, registerFolder } from "../lib/idb";
import {
  remapLeafPaths,
  resetLayout,
  reviveLayout,
  setPanePath,
} from "../lib/ui";
import * as A from "../state/atoms";

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

function baseOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function joinRel(a: string, b: string): string {
  return a ? `${a}/${b}` : b;
}

// バックグラウンド索引の世代。新しい構築が始まると古い構築は中断する。
let indexGen = 0;

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

  // 全 md を読み込み、全文検索インデックス（生テキストのキャッシュ）を
  // バックグラウンドで構築する。UI はツリー表示直後から操作可能。
  const indexContents = useCallback(
    async (files: TreeNode[], gen: number) => {
      const total = files.length;
      // 読み込んだ分を「ライブキャッシュへマージ」する（自前 Map で上書きしない）。
      // 索引中のファイル操作/編集の変更を潰さず、白フラッシュも起きない。
      let batch = new Map<string, string>();
      const flush = (done: number, active: boolean) => {
        if (batch.size) {
          const merged = new Map(store.get(A.contentCacheAtom));
          for (const [k, v] of batch) if (!merged.has(k)) merged.set(k, v);
          store.set(A.contentCacheAtom, merged);
          batch = new Map();
        }
        store.set(A.loadingAtom, {
          active,
          message: active ? "インデックス構築中" : "",
          done,
          total,
        });
      };
      flush(0, true);
      for (let i = 0; i < files.length; i++) {
        if (gen !== indexGen) return; // 新しい構築に置き換えられたら中断
        const node = files[i];
        if (!store.get(A.contentCacheAtom).has(node.path) && !batch.has(node.path)) {
          try {
            const data = await readFile(node.abs);
            batch.set(node.path, data.text);
          } catch {
            /* 読み込めないファイルはスキップ */
          }
        }
        if (i % 40 === 0) flush(i, true);
      }
      if (gen !== indexGen) return;
      flush(total, false);
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
    // インデックスはバックグラウンドで（await しない）
    const gen = ++indexGen;
    void indexContents(files, gen);
  }, [store, getRootPath, indexContents]);

  // ツリー構造だけ更新（全文再インデックスしない）。ファイル操作用。
  const refreshTreeStructure = useCallback(async () => {
    const root = getRootPath();
    if (!root) return;
    const tree = await buildTree(root);
    store.set(A.treeAtom, tree);
    store.set(A.filesAtom, flattenFiles(tree));
  }, [store, getRootPath]);

  // contentCache のキーを写像で更新（rename/move/delete 用）。
  const remapCache = useCallback(
    (mapper: (path: string) => string | null) => {
      const src = store.get(A.contentCacheAtom);
      const next = new Map<string, string>();
      for (const [k, v] of src) {
        const nk = mapper(k);
        if (nk) next.set(nk, v);
      }
      store.set(A.contentCacheAtom, next);
    },
    [store],
  );

  // rename/move のパス付け替え。キャッシュとレイアウトの不整合による
  // 一瞬の空表示(白フラッシュ)を避けるため、
  //   1) 新キーを「加算」(旧キーは残す) → キー欠落の瞬間を作らない
  //   2) レイアウトのパスを更新
  //   3) ツリー再構築
  //   4) 実在ファイルに無い旧キーを掃除
  // の順で行う。
  const applyPathRemap = useCallback(
    async (remap: (p: string | null) => string | null) => {
      const cur = new Map(store.get(A.contentCacheAtom));
      for (const [k, v] of [...cur]) {
        const nk = remap(k);
        if (nk && nk !== k) cur.set(nk, v);
      }
      store.set(A.contentCacheAtom, cur);
      remapLeafPaths(store, remap);
      await refreshTreeStructure();
      const valid = new Set(store.get(A.filesAtom).map((f) => f.path));
      store.set(
        A.contentCacheAtom,
        new Map([...store.get(A.contentCacheAtom)].filter(([k]) => valid.has(k))),
      );
    },
    [store, refreshTreeStructure],
  );

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
      // 前フォルダの内容が検索/キャッシュに残らないよう初期化
      store.set(A.contentCacheAtom, new Map());
      store.set(A.mtimeCacheAtom, new Map());
      await refreshTree();
      if (saved) {
        const valid = new Set(store.get(A.filesAtom).map((f) => f.path));
        const { layout, active } = reviveLayout(
          saved.layout,
          valid,
          saved.active,
        );
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
      if (
        !store.get(A.filesAtom).some((f) => f.path === target) &&
        !/\.[a-z]+$/i.test(target)
      ) {
        target = `${target}.md`;
      }
      if (store.get(A.filesAtom).some((f) => f.path === target))
        openFile(target);
    },
    [store, openFile],
  );

  // 相対パス資産（画像など）: キャッシュ済み blob URL を同期取得。
  const peekAsset = useCallback(
    (fromDocPath: string, src: string): string | null => {
      const root = getRootPath();
      if (!root) return null;
      const full = resolvePath(dirOf(fromDocPath), src);
      if (!full) return null;
      return peekImageUrl(`${root}/${full}`);
    },
    [getRootPath],
  );

  // 画像を fs 経由で読み blob URL 化（非同期）。
  const resolveAsset = useCallback(
    async (fromDocPath: string, src: string): Promise<string | null> => {
      const root = getRootPath();
      if (!root) return null;
      const full = resolvePath(dirOf(fromDocPath), src);
      if (!full) return null;
      return imageUrl(`${root}/${full}`);
    },
    [getRootPath],
  );

  // ---- ファイル操作（Obsidian 風の編集機能） ----
  const absOf = useCallback(
    (rel: string): string | null => {
      const root = getRootPath();
      return root ? `${root}/${rel}` : null;
    },
    [getRootPath],
  );

  // 一意な名前を作る（重複時に連番）。
  const uniqueRel = useCallback(
    async (rel: string): Promise<string> => {
      const abs = absOf(rel);
      if (!abs || !(await pathExists(abs))) return rel;
      const dir = dirOf(rel);
      const base = baseOf(rel);
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      for (let i = 2; i < 1000; i++) {
        const cand = joinRel(dir, `${stem} ${i}${ext}`);
        const a = absOf(cand);
        if (a && !(await pathExists(a))) return cand;
      }
      return rel;
    },
    [absOf],
  );

  const createFile = useCallback(
    async (parentRel: string, name: string) => {
      let fileName = name.trim();
      if (!fileName) return;
      if (!/\.[a-z0-9]+$/i.test(fileName)) fileName += ".md";
      const rel = await uniqueRel(joinRel(parentRel, fileName));
      const abs = absOf(rel);
      if (!abs) return;
      const stem = baseOf(rel).replace(/\.[^.]+$/, "");
      const initial = isMarkdown(rel) ? `# ${stem}\n\n` : "";
      await writeFile(abs, initial);
      const content = new Map(store.get(A.contentCacheAtom));
      content.set(rel, initial);
      store.set(A.contentCacheAtom, content);
      await refreshTreeStructure();
      openFile(rel);
    },
    [absOf, uniqueRel, refreshTreeStructure, openFile, store],
  );

  const createFolder = useCallback(
    async (parentRel: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      const rel = await uniqueRel(joinRel(parentRel, n));
      const abs = absOf(rel);
      if (!abs) return;
      await createDir(abs);
      await refreshTreeStructure();
    },
    [absOf, uniqueRel, refreshTreeStructure],
  );

  const renameEntry = useCallback(
    async (rel: string, newName: string, isDir: boolean) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      let base = trimmed;
      if (!isDir && !/\.[a-z0-9]+$/i.test(base)) base += ".md";
      const newRel = joinRel(dirOf(rel), base);
      if (newRel === rel) return;
      const oldAbs = absOf(rel);
      const newAbs = absOf(newRel);
      if (!oldAbs || !newAbs) return;
      await renamePath(oldAbs, newAbs);
      const remap = (p: string | null) => {
        if (p === rel) return newRel;
        if (p && p.startsWith(rel + "/")) return newRel + p.slice(rel.length);
        return p;
      };
      await applyPathRemap(remap);
    },
    [absOf, applyPathRemap],
  );

  const deleteEntry = useCallback(
    async (rel: string, isDir: boolean) => {
      const abs = absOf(rel);
      if (!abs) return;
      await removePath(abs, isDir);
      const gone = (p: string | null) =>
        p === rel || (p && p.startsWith(rel + "/")) ? null : p;
      remapLeafPaths(store, gone);
      remapCache((p) => gone(p) ?? null);
      await refreshTreeStructure();
    },
    [absOf, store, refreshTreeStructure, remapCache],
  );

  const moveEntry = useCallback(
    async (rel: string, destDirRel: string) => {
      if (
        rel === destDirRel ||
        destDirRel.startsWith(rel + "/") ||
        dirOf(rel) === destDirRel
      )
        return;
      const newRel = await uniqueRel(joinRel(destDirRel, baseOf(rel)));
      const oldAbs = absOf(rel);
      const newAbs = absOf(newRel);
      if (!oldAbs || !newAbs) return;
      await renamePath(oldAbs, newAbs);
      const remap = (p: string | null) => {
        if (p === rel) return newRel;
        if (p && p.startsWith(rel + "/")) return newRel + p.slice(rel.length);
        return p;
      };
      await applyPathRemap(remap);
    },
    [absOf, uniqueRel, applyPathRemap],
  );

  const saveFile = useCallback(
    async (rel: string, text: string) => {
      const abs = absOf(rel);
      if (!abs) return;
      await writeFile(abs, text);
      const content = new Map(store.get(A.contentCacheAtom));
      content.set(rel, text);
      store.set(A.contentCacheAtom, content);
    },
    [absOf, store],
  );

  return {
    getRootPath,
    refreshFolders,
    openFolder,
    refreshTree,
    refreshTreeStructure,
    reloadFile,
    openFile,
    navigate,
    resolveAsset,
    peekAsset,
    createFile,
    createFolder,
    renameEntry,
    deleteEntry,
    moveEntry,
    saveFile,
  };
}
