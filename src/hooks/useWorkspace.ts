import { message } from "@tauri-apps/plugin-dialog";
import { useStore } from "jotai";
import { useCallback } from "react";
import {
  buildTree,
  createDir,
  flattenFiles,
  ancestorPaths,
  folderMtimes,
  imageUrl,
  isMarkdown,
  pathExists,
  peekImageUrl,
  readFile,
  readText,
  removePath,
  renamePath,
  writeFile,
  type TreeNode,
} from "../lib/fsAccess";
import { folderDisplayName, loadFolders, registerFolder } from "../lib/idb";
import {
  openDocWindow,
  recordRecentFolder,
  type DropPoint,
} from "../lib/windows";
import {
  remapLeafPaths,
  resetLayout,
  reviveLayout,
  openInPane,
} from "../lib/ui";
import * as A from "../state/atoms";

// ファイル単位のドキュメント Undo/Redo 履歴（保存＝1ステップ）。
const contentHistory = new Map<string, { undo: string[]; redo: string[] }>();
const HISTORY_LIMIT = 80;
function histFor(rel: string) {
  let h = contentHistory.get(rel);
  if (!h) {
    h = { undo: [], redo: [] };
    contentHistory.set(rel, h);
  }
  return h;
}

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

// 手が空いてから走らせる。requestIdleCallback が無ければ少し待つ。
function whenIdle(run: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 400);
  }
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
            batch.set(node.path, await readText(node.abs));
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
    // 走査の間も何か出しておく。数百のフォルダを辿るので、無言で止まると
    // 固まったように見える。
    store.set(A.loadingAtom, {
      active: true,
      message: "フォルダを読み込み中",
      done: 0,
      total: 0,
    });
    const tree = await buildTree(root);
    const files = flattenFiles(tree);
    store.set(A.treeAtom, tree);
    store.set(A.filesAtom, files);
    // 更新時刻は並び順にしか使わないので、待たずに後から入れる。
    void folderMtimes(root).then(
      (m) => store.set(A.touchedAtom, m),
      (e: unknown) => {
        console.error("更新時刻を読めません", e);
      },
    );
    // インデックスは全ファイルを読むので、最初の描画と取り合いにならないよう
    // 手が空いてから始める（await もしない）
    const gen = ++indexGen;
    whenIdle(() => void indexContents(files, gen));
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

  const reloadFile = useCallback(
    async (path: string) => {
      // ツリーがまだ無くても読めるようにする。ウィンドウを開いた直後は
      // フォルダ全体の走査が終わっておらず、待つと本文が出るのが遅れる。
      const root = getRootPath();
      const abs = getFileNode(path)?.abs ?? (root ? `${root}/${path}` : null);
      if (!abs) return;
      try {
        const data = await readFile(abs);
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
    [store, getFileNode, getRootPath],
  );

  const openFile = useCallback(
    (path: string, paneId?: string) => {
      const targetPane = paneId ?? store.get(A.activePaneIdAtom);
      openInPane(store, targetPane, path);
      if (!store.get(A.contentCacheAtom).has(path)) void reloadFile(path);
    },
    [store, reloadFile],
  );

  // 復元したタブの置き場所をツリーで開いておく。タブだけ戻して閉じたままだと、
  // 開いているファイルが木のどこにあるのか辿り直すことになる。
  const revealTabs = useCallback(
    (folderId: string, layout: A.LayoutNode) => {
      const paths: string[] = [];
      const walk = (node: A.LayoutNode) => {
        if (node.kind === "leaf") paths.push(...node.tabs);
        else node.children.forEach(walk);
      };
      walk(layout);
      if (paths.length === 0) return;
      const open = new Set(store.get(A.expandedByFolderAtom)[folderId] ?? []);
      for (const path of paths) for (const dir of ancestorPaths(path)) open.add(dir);
      store.set(A.expandedByFolderAtom, (prev) => ({
        ...prev,
        [folderId]: [...open],
      }));
    },
    [store],
  );

  // フォルダを開く。file を渡すと、そのファイルはツリーの走査を待たずに出す。
  // 走査は数百〜千のファイルを辿るので、待つと本文が出るまでが目に見えて遅い。
  const openFolder = useCallback(
    async (path: string, opts: { file?: string } = {}) => {
      const now = Math.floor(performance.timeOrigin + performance.now());
      const folders = await registerFolder(path, now);
      store.set(A.foldersAtom, folders);
      const activeId = path;
      // Dock メニューから読めるよう、Rust 側にも履歴を残す
      void recordRecentFolder(path, now).catch((e: unknown) => {
        console.error("最近開いたフォルダを記録できません", e);
      });
      // 永続化 effect に上書きされる前に保存レイアウトを先読みしておく。
      // このウィンドウでの控えが無ければ、ウィンドウを問わない控えを使う。
      const saved =
        store.get(A.savedLayoutsAtom)[activeId] ??
        store.get(A.sessionLayoutsAtom)[activeId];
      store.set(A.activeFolderIdAtom, activeId);
      resetLayout(store);
      // 前フォルダの内容が検索/キャッシュに残らないよう初期化
      store.set(A.contentCacheAtom, new Map());
      store.set(A.mtimeCacheAtom, new Map());
      // 保存レイアウトがあるとこの後それで置き換わるので、先出しは意味が無い
      if (opts.file && !saved) openFile(opts.file);
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
        revealTabs(activeId, layout);
      }
    },
    [store, refreshTree, openFile, revealTabs],
  );

  // ファイルを別ウィンドウで開く。タイトルはフォルダ名にして、
  // Dock メニューのウィンドウ一覧でどのフォルダか分かるようにする。
  const openInNewWindow = useCallback(
    async (path: string | null, at?: DropPoint): Promise<boolean> => {
      const folderId = store.get(A.activeFolderIdAtom);
      if (!folderId) return false;
      const entry = store.get(A.foldersAtom).find((f) => f.id === folderId);
      const title = entry ? folderDisplayName(entry) : "fude";
      try {
        await openDocWindow(folderId, path, title, at);
        return true;
      } catch (e) {
        void message(`新しいウィンドウを開けませんでした。\n${String(e)}`, {
          title: "fude",
          kind: "error",
        });
        return false;
      }
    },
    [store],
  );

  // 登録フォルダを別のウィンドウで開く。作用中のフォルダとは関係なく開ける。
  const openFolderInNewWindow = useCallback(
    async (folderId: string, title: string): Promise<boolean> => {
      try {
        await openDocWindow(folderId, null, title);
        return true;
      } catch (e) {
        void message(`新しいウィンドウを開けませんでした。\n${String(e)}`, {
          title: "fude",
          kind: "error",
        });
        return false;
      }
    },
    [],
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

  // 履歴を積まずにキャッシュ＋ディスクへ書く（undo/redo の実体）。
  const writeContent = useCallback(
    async (rel: string, text: string) => {
      const abs = absOf(rel);
      if (!abs) return;
      // 先にキャッシュを更新（楽観的）＝ UI を即反映し、ブロック削除時に一瞬
      // 元内容が再表示される「がくっ」を防ぐ。書き込みは後追い。
      const content = new Map(store.get(A.contentCacheAtom));
      content.set(rel, text);
      store.set(A.contentCacheAtom, content);
      await writeFile(abs, text);
    },
    [absOf, store],
  );

  const saveFile = useCallback(
    async (rel: string, text: string) => {
      // 直前の内容を undo スタックへ（redo はクリア）
      const prev = store.get(A.contentCacheAtom).get(rel);
      if (prev !== undefined && prev !== text) {
        const h = histFor(rel);
        h.undo.push(prev);
        if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
        h.redo = [];
      }
      await writeContent(rel, text);
    },
    [store, writeContent],
  );

  // ドキュメント全体の Undo/Redo（編集確定後に 1 ステップ単位で巻き戻す）。
  const undoFile = useCallback(
    async (rel: string) => {
      const h = contentHistory.get(rel);
      if (!h || h.undo.length === 0) return false;
      const cur = store.get(A.contentCacheAtom).get(rel) ?? "";
      const prev = h.undo.pop() as string;
      h.redo.push(cur);
      await writeContent(rel, prev);
      return true;
    },
    [store, writeContent],
  );

  const redoFile = useCallback(
    async (rel: string) => {
      const h = contentHistory.get(rel);
      if (!h || h.redo.length === 0) return false;
      const cur = store.get(A.contentCacheAtom).get(rel) ?? "";
      const next = h.redo.pop() as string;
      h.undo.push(cur);
      await writeContent(rel, next);
      return true;
    },
    [store, writeContent],
  );

  return {
    getRootPath,
    absOf,
    refreshFolders,
    openFolder,
    refreshTree,
    refreshTreeStructure,
    reloadFile,
    openFile,
    openInNewWindow,
    openFolderInNewWindow,
    navigate,
    resolveAsset,
    peekAsset,
    createFile,
    createFolder,
    renameEntry,
    deleteEntry,
    moveEntry,
    saveFile,
    undoFile,
    redoFile,
  };
}
