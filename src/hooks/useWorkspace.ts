import { message } from "@tauri-apps/plugin-dialog";
import { useStore, type getDefaultStore } from "jotai";
import { useCallback, useRef } from "react";
import { isViewable, kindOf } from "../lib/kind";
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
  soleTree,
  writeFile,
  type TreeNode,
} from "../lib/fsAccess";
import {
  folderDisplayName,
  loadDocs,
  loadFolders,
  registerDoc,
  registerFolder,
  removeDoc,
} from "../lib/idb";
import {
  openDocWindow,
  recordRecentFolder,
  type DropPoint,
} from "../lib/windows";
import { moveReviewFile } from "../lib/review";
import {
  draftsDir,
  dropDraft,
  inDrafts,
  leftoverDrafts,
  newDraft as makeDraft,
} from "../lib/drafts";
import { notify } from "../state/toast";
import { moveViewpoints } from "../lib/viewpoint";
import {
  remapLeafPaths,
  resetLayout,
  reviveLayout,
  openInPane,
} from "../lib/ui";
import * as A from "../state/atoms";
import { syncLedger } from "../state/review";

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


type Store = ReturnType<typeof getDefaultStore>;

// ツリーに出すもの。設定が切られていれば Markdown だけ並べる。
const shownFiles = (store: Store) =>
  store.get(A.showOtherFilesAtom) ? isViewable : isMarkdown;

export function useWorkspace() {
  const store = useStore();

  // 作用中の根。フォルダ ID は絶対パスそのものなので、登録の有無に関わらず
  // これが根になる（1 枚だけ開いているときは、そのファイルの親フォルダ）。
  const getRootPath = useCallback((): string | null => {
    return store.get(A.activeFolderIdAtom);
  }, [store]);

  const absOf = useCallback(
    (rel: string): string | null => {
      const root = getRootPath();
      return root ? `${root}/${rel}` : null;
    },
    [getRootPath],
  );

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
    // 1 枚だけ開いているときはフォルダを走査しない。数千のファイルを辿っても
    // 出すのは 1 行だけで、索引も要らない。
    const sole = store.get(A.soleAtom);
    if (sole) {
      const { node } = soleTree(sole);
      store.set(A.treeAtom, [node]);
      store.set(A.filesAtom, [node]);
      return;
    }
    // 走査の間も何か出しておく。数百のフォルダを辿るので、無言で止まると
    // 固まったように見える。
    store.set(A.loadingAtom, {
      active: true,
      message: "フォルダを読み込み中",
      done: 0,
      total: 0,
    });
    const tree = await buildTree(root, shownFiles(store));
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
    // 索引に入れるのは Markdown だけ。画像や PDF を文字として読んでも中身は
    // 引けないし、大きいものを丸ごと抱えることになる。
    const docs = files.filter((f) => kindOf(f.name) === "markdown");
    whenIdle(() => void indexContents(docs, gen));
  }, [store, getRootPath, indexContents]);

  // ツリー構造だけ更新（全文再インデックスしない）。ファイル操作用。
  const refreshTreeStructure = useCallback(async () => {
    const root = getRootPath();
    if (!root) return;
    // 1 枚だけ開いているときは走査しない（出すのはその 1 行だけ）。
    const sole = store.get(A.soleAtom);
    if (sole) {
      const { node } = soleTree(sole);
      store.set(A.treeAtom, [node]);
      store.set(A.filesAtom, [node]);
      return;
    }
    const tree = await buildTree(root, shownFiles(store));
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
    async (remap: (p: string | null) => string | null, moved?: [string, string]) => {
      const cur = new Map(store.get(A.contentCacheAtom));
      for (const [k, v] of [...cur]) {
        const nk = remap(k);
        if (nk && nk !== k) cur.set(nk, v);
      }
      store.set(A.contentCacheAtom, cur);
      // 読み込んだ時刻と、見ていた位置も一緒に連れていく。置いていくと、
      // 名前を変えただけで先頭に戻る。
      const times = new Map(store.get(A.mtimeCacheAtom));
      for (const [k, v] of [...times]) {
        const nk = remap(k);
        if (nk && nk !== k) times.set(nk, v);
      }
      store.set(A.mtimeCacheAtom, times);
      if (moved) {
        moveViewpoints(moved[0], moved[1]);
        // 1 枚だけ開いているなら、その 1 枚が動いたときに指す先も連れていく。
        // 置いていくと、次に木を組み直したときに消えたファイルを指す。
        const sole = store.get(A.soleAtom);
        if (sole && sole === absOf(moved[0])) {
          const next = absOf(moved[1]);
          if (next) store.set(A.soleAtom, next);
        }
        // 指摘と版は絶対パスで台帳に紐付いている。ここで連れていかないと、
        // 名前を変えた時点でそのファイルの指摘が引けなくなる。
        const from = absOf(moved[0]);
        const to = absOf(moved[1]);
        if (from && to) {
          void moveReviewFile(from, to).then(() => syncLedger(store));
        }
      }
      remapLeafPaths(store, remap);
      await refreshTreeStructure();
      const valid = new Set(store.get(A.filesAtom).map((f) => f.path));
      store.set(
        A.contentCacheAtom,
        new Map([...store.get(A.contentCacheAtom)].filter(([k]) => valid.has(k))),
      );
    },
    [store, refreshTreeStructure, absOf],
  );

  const refreshFolders = useCallback(async () => {
    store.set(A.foldersAtom, await loadFolders());
    store.set(A.recentDocsAtom, await loadDocs());
    // 下書きの置き場は、ここで 1 度だけ求めて覚える。分かるまでは
    // 「下書きかどうか」を判定しない（道筋を人に見せてしまわないように）。
    store.set(A.draftsDirAtom, await draftsDir());
  }, [store]);


  const reloadFile = useCallback(
    async (path: string) => {
      // Markdown 以外は本文を読まない。見せ方は種類ごとの画面が持っていて、
      // 本文は要らない（画像やＰＤＦを文字として読むと化けるだけ）。
      if (kindOf(path) !== "markdown") return;
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
  //
  // only を渡すと「そのファイルだけの窓」として開く。控えのレイアウトは使わない。
  // 下書きを開いたまま別の画面へ移らない。行き先を決めるまで引き止める。
  //
  // 書きかけを 2 つ以上持たせないための関所。**下書きから離れる道を新しく
  // 作るときは、必ずここを通す。** いま通しているのは次の 7 つ。
  //
  //   閉じる（⌘W・タブの ✕・中クリック）  lib/ui.ts の closeTab
  //   フォルダを切り替える                  openFolder
  //   別のファイルを開く                    openDoc
  //   「フォルダ...」「ファイル...」        FolderSwitcher（選ぶ前に問う）
  //   スタート画面へ                        Toolbar
  //   戻る・進む（⌘[ ⌘]）                  useUrlSync
  //   別の窓へ引き出す                      openInNewWindow
  //
  // 何も書いていないと**分かっている**ときだけ、問わずに捨てて通す。
  const holdDraft = useCallback(
    (go: () => void): boolean => {
      const sole = store.get(A.soleAtom);
      if (!sole || !inDrafts(sole, store.get(A.draftsDirAtom))) return false;
      // 控えが「空だと分かっている」ときだけ黙って捨てる。まだ読めていない
      // （鍵が無い）ときは分からないので問う。打った字を黙って消さない。
      const rel = sole.split("/").pop() ?? "";
      const cache = store.get(A.contentCacheAtom);
      if (cache.has(rel) && cache.get(rel)!.trim() === "") {
        void dropDraft(sole);
        return false;
      }
      store.set(A.draftAskAtom, { path: sole, go });
      return true;
    },
    [store],
  );

  const openFolderRef = useRef<
    ((path: string, opts?: { file?: string; only?: boolean; force?: boolean }) => void) | null
  >(null);

  const openFolder = useCallback(
    async (
      path: string,
      opts: { file?: string; only?: boolean; force?: boolean } = {},
    ) => {
      if (
        !opts.force &&
        holdDraft(() => openFolderRef.current?.(path, { ...opts, force: true }))
      ) {
        return;
      }
      const now = Math.floor(performance.timeOrigin + performance.now());
      store.set(A.soleAtom, null);
      const activeId = path;
      // 履歴への登録は画面を進めてからでよい。待つと、押してから何も変わらない
      // 間ができる。Dock メニューから読めるよう Rust 側にも残す。
      void registerFolder(path, now).then((list) => store.set(A.foldersAtom, list));
      void recordRecentFolder(path, now).catch((e: unknown) => {
        console.error("最近開いたフォルダを記録できません", e);
      });
      // 永続化 effect に上書きされる前に保存レイアウトを先読みしておく。
      // このウィンドウでの控えが無ければ、ウィンドウを問わない控えを使う。
      // ただし「そのファイルだけの窓」を頼まれているときは落ちない。他の
      // ウィンドウで開いていたタブを並べ直すと、窓を複製しただけになる。
      const saved =
        store.get(A.savedLayoutsAtom)[activeId] ??
        (opts.only ? undefined : store.get(A.sessionLayoutsAtom)[activeId]);
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

  // Markdown を 1 枚だけ開く。
  //
  // 親フォルダを根に据え、ファイル一覧をその 1 枚に絞るだけ。こうすると
  // 相対リンク・相対画像・レビュー・版がフォルダを開いたときと同じ道を通る。
  // 親フォルダは最近のフォルダに登録しない（開いたのはファイルであって
  // フォルダではない）。
  openFolderRef.current = (path, opts) => void openFolder(path, opts);

  const openDocRef = useRef<((abs: string, opts?: { force?: boolean }) => void) | null>(
    null,
  );

  const openDoc = useCallback(
    (abs: string, opts: { force?: boolean } = {}) => {
      if (
        !opts.force &&
        holdDraft(() => openDocRef.current?.(abs, { force: true }))
      ) {
        return;
      }
      const { root, node } = soleTree(abs);
      // 画面を先に進める。ここに await を挟むと、押してから何も変わらない間が
      // できて、反応していないように見える。
      store.set(A.soleAtom, abs);
      store.set(A.activeFolderIdAtom, root);
      resetLayout(store);
      store.set(A.contentCacheAtom, new Map());
      store.set(A.mtimeCacheAtom, new Map());
      store.set(A.treeAtom, [node]);
      store.set(A.filesAtom, [node]);
      openFile(node.path);

      // 実体の確かめと履歴への登録は後ろへ回す。無ければ開いた画面を畳んで
      // 履歴から落とす（先に確かめると、その往復のぶん画面が止まる）。
      void pathExists(abs).then((there) => {
        if (store.get(A.soleAtom) !== abs) return;
        if (!there) {
          void removeDoc(abs).then((list) => store.set(A.recentDocsAtom, list));
          store.set(A.soleAtom, null);
          store.set(A.activeFolderIdAtom, null);
          notify(store, "そのファイルはもうありません");
          return;
        }
        // 下書きは履歴に載せない。まだ行き場が決まっていないものを
        // 「最近開いたもの」として並べると、保存したかどうかが分からなくなる。
        if (inDrafts(abs, store.get(A.draftsDirAtom))) return;
        const now = Math.floor(performance.timeOrigin + performance.now());
        void registerDoc(abs, now).then((list) => store.set(A.recentDocsAtom, list));
      });
    },
    [store, openFile, holdDraft],
  );
  openDocRef.current = openDoc;

  // 保存先の決まっていないメモを作って開く。
  //
  // 置き場が違うだけで、作ったあとは 1 枚だけ開いたファイルと同じ道を通る。
  // 自動保存・レビュー・版はそのまま効く。
  const newDraft = useCallback(async () => {
    // 書きかけは 1 つまで。既に開いていればそのまま、前回の残りがあれば
    // それを開き直す。作るのは、どこにも無いときだけ。
    const sole = store.get(A.soleAtom);
    if (sole && inDrafts(sole, store.get(A.draftsDirAtom))) return sole;
    const left = await leftoverDrafts().catch(() => []);
    const abs = left[0] ?? (await makeDraft(Date.now()));
    openDoc(abs);
    return abs;
  }, [store, openDoc]);

  // ファイルを別ウィンドウで開く。タイトルはフォルダ名にして、
  // Dock メニューのウィンドウ一覧でどのフォルダか分かるようにする。
  const openInNewWindow = useCallback(
    async (path: string | null, at?: DropPoint): Promise<boolean> => {
      // 下書きは置き場ごと別の窓へ持ち出せない。行き先を決めてから。
      if (holdDraft(() => {})) return false;
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

  // 名前が変わったときの写像。そのファイルと、その下に居るものを付け替える。
  const remapper = (from: string, to: string) => (p: string | null) => {
    if (p === from) return to;
    if (p && p.startsWith(`${from}/`)) return to + p.slice(from.length);
    return p;
  };

  // 外で名前が変わったとき、開いているタブをそのファイルへ付け替える。
  // ディスクはもう変わっているので、付け替えと読み直しだけを行う。
  const adoptRename = useCallback(
    async (from: string, to: string) => {
      await applyPathRemap(remapper(from, to), [from, to]);
      await reloadFile(to);
    },
    [applyPathRemap, reloadFile],
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
      await applyPathRemap(remapper(rel, newRel), [rel, newRel]);
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
      await applyPathRemap(remapper(rel, newRel), [rel, newRel]);
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

  // checkpoint: 文書全体の Undo に 1 段積むか。自動保存は積まない
  // （0.5 秒ごとに 1 段になると、⌘Z が実質使えなくなる）。
  const saveFile = useCallback(
    async (rel: string, text: string, opts?: { checkpoint?: boolean }) => {
      if (opts?.checkpoint !== false) {
        const prev = store.get(A.contentCacheAtom).get(rel);
        if (prev !== undefined && prev !== text) {
          const h = histFor(rel);
          h.undo.push(prev);
          if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
          h.redo = [];
        }
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
    openDoc,
    newDraft,
    holdDraft,
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
    adoptRename,
    deleteEntry,
    moveEntry,
    saveFile,
    undoFile,
    redoFile,
  };
}
