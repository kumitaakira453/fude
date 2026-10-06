import { message } from "@tauri-apps/plugin-dialog";
import { useStore, type getDefaultStore } from "jotai";
import { useCallback, useRef } from "react";
import { kindOf, VIEWABLE_SIEVE } from "../lib/kind";
import { span } from "../lib/measure";
import {
  buildTree,
  createDir,
  flattenFiles,
  ancestorPaths,
  folderMtimes,
  imageUrl,
  MARKDOWN_SIEVE,
  pathExists,
  peekImageUrl,
  readFile,
  readText,
  removePath,
  renamePath,
  soleTree,
  absoluteIn,
  rootNode,
  rootOf,
  writeBytes,
  writeFile,
  type TreeNode,
} from "../lib/fsAccess";
import type { Brought } from "../lib/intake";
import {
  folderDisplayName,
  loadDocs,
  loadFolders,
  registerDoc,
  registerFolder,
  removeDoc,
  rootName,
} from "../lib/idb";
import {
  currentWindowLabel,
  openDocWindow,
  openWorkspaceWindow,
  recordRecentFolder,
  type DropPoint,
} from "../lib/windows";
import { bindWindow, focusWorkspace, saveWorkspace, type Workspace } from "../lib/workspaces";
import {
  flushWorkspaceSave,
  folderWorkspace,
  refreshWorkspaces,
  sameList,
  upsertWorkspace,
} from "../state/workspace";
import { addToBar, barAtom, visit, visitedAtom } from "../state/workspaceBar";
import { stashRoots, takeStash } from "../state/rootStash";
import { moveReviewFile } from "../lib/review";
import {
  draftsDir,
  dropDraft,
  inDrafts,
  leftoverDrafts,
  newDraft as makeDraft,
} from "../lib/drafts";
import { splitHref } from "../lib/anchors";
import { dirOf, resolvePath } from "../lib/paths";
import { notify, notifyBusy, settle } from "../state/toast";
import { moveViewpoints } from "../lib/viewpoint";
import { dropFolderIcons, moveFolderIcons } from "../lib/folderIcons";
import {
  remapLeafPaths,
  resetLayout,
  reviveLayout,
  openInPane,
  type StoredNode,
} from "../lib/ui";
import * as A from "../state/atoms";
import { syncLedger } from "../state/review";

// ファイル単位のドキュメント Undo/Redo 履歴（保存＝1ステップ）。鍵は絶対パス。
const contentHistory = new Map<string, { undo: string[]; redo: string[] }>();
const HISTORY_LIMIT = 80;
function histFor(path: string) {
  let h = contentHistory.get(path);
  if (!h) {
    h = { undo: [], redo: [] };
    contentHistory.set(path, h);
  }
  return h;
}

function baseOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

// 同時に走らせる本数。落としたフォルダの中身を一度に全部投げると、
// 書き込みの往復が詰まって画面が止まる。
const WRITE_AT_ONCE = 8;

async function inTurn<T>(
  list: T[],
  width: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let at = 0;
  const lane = async () => {
    for (;;) {
      const i = at++;
      if (i >= list.length) return;
      await run(list[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(width, list.length) }, () => lane()),
  );
}

// バックグラウンド索引の世代。新しい構築が始まると古い構築は中断する。
let indexGen = 0;

// 木の走査の世代。走査は待たずに走らせるので、続けて開いたときに古い結果が
// 新しい木を上書きしないよう、戻ってきた時点で自分が最後かを確かめる。
let treeGen = 0;

// 最後に開いたフォルダの木と、控えのタブが並び終わる時。起動の幕を下ろす
// 合図に使う（開く操作そのものは、走査を待たずに画面を進める）。
let opened: Promise<void> = Promise.resolve();
export const whenOpened = (): Promise<void> => opened;

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
const sieveOf = (store: Store) =>
  store.get(A.showOtherFilesAtom) ? VIEWABLE_SIEVE : MARKDOWN_SIEVE;

// 並べている根をそれぞれの決まりで走査して、木に組む。根が 1 つなら今どおり
// 中身を最上段に、2 つ以上なら根を行として並べてその下に吊るす。
async function scanRoots(store: Store): Promise<TreeNode[]> {
  const roots = store.get(A.rootsAtom);
  const ignores = store.get(A.ignoresByRootAtom);
  const sieve = sieveOf(store);
  const forests = await Promise.all(
    roots.map((root) => buildTree(root, sieve, ignores.get(root) ?? "")),
  );
  return plant(store, roots, forests);
}

function plant(store: Store, roots: string[], forests: TreeNode[][]): TreeNode[] {
  if (roots.length === 1) return forests[0];
  const folders = store.get(A.foldersAtom);
  return roots.map((root, i) => rootNode(root, rootName(folders, root), forests[i]));
}

// 木の形（フォルダも含めた並び）が同じか。
function sameShape(a: TreeNode[], b: TreeNode[]): boolean {
  const lines = (tree: TreeNode[]) => {
    const out: string[] = [];
    const walk = (list: TreeNode[]) => {
      for (const node of list) {
        out.push(`${node.kind}:${node.path}:${node.name}`);
        if (node.children) walk(node.children);
      }
    };
    walk(tree);
    return out.join("\n");
  };
  return lines(a) === lines(b);
}

export function useWorkspace() {
  const store = useStore();

  // 作用中の根。フォルダ ID は絶対パスそのものなので、登録の有無に関わらず
  // これが根になる（1 枚だけ開いているときは、そのファイルの親フォルダ）。
  const getRootPath = useCallback((): string | null => {
    return store.get(A.activeFolderIdAtom);
  }, [store]);

  // そのファイルが属する根。根の外なら null。
  const rootFor = useCallback(
    (path: string): string | null => rootOf(store.get(A.rootsAtom), path),
    [store],
  );

  // 全 md を読み込み、全文検索インデックス（生テキストのキャッシュ）を
  // バックグラウンドで構築する。UI はツリー表示直後から操作可能。
  //
  // stamps は読む前に取った各ファイルの更新時刻。控えの本文の時刻と同じものは
  // 読まない（ワークスペースを行き来したとき、変わったものだけを読み直す）。
  const indexContents = useCallback(
    async (docs: TreeNode[], gen: number, stamps: Map<string, number>) => {
      const cache = store.get(A.contentCacheAtom);
      const times = store.get(A.mtimeCacheAtom);
      const files = docs.filter((f) => {
        if (!cache.has(f.path)) return true;
        const now = stamps.get(f.path);
        return now !== undefined && times.get(f.path) !== now;
      });
      if (files.length === 0) return;
      // 読み直すものは、読んでいるあいだに書き換えられていなければ差し替える。
      const before = new Map(files.map((f) => [f.path, cache.get(f.path)]));
      const total = files.length;
      // 読み込んだ分を「ライブキャッシュへマージ」する（自前 Map で上書きしない）。
      // 索引中のファイル操作/編集の変更を潰さず、白フラッシュも起きない。
      let batch = new Map<string, string>();
      const flush = (done: number, active: boolean) => {
        if (batch.size) {
          const merged = new Map(store.get(A.contentCacheAtom));
          const stamped = new Map(store.get(A.mtimeCacheAtom));
          for (const [k, v] of batch) {
            if (merged.get(k) !== before.get(k)) continue;
            merged.set(k, v);
            const at = stamps.get(k);
            if (at !== undefined) stamped.set(k, at);
          }
          store.set(A.contentCacheAtom, merged);
          store.set(A.mtimeCacheAtom, stamped);
          batch = new Map();
        }
        store.set(A.loadingAtom, {
          active,
          message: active ? "インデックス構築中" : "",
          done,
          total,
        });
      };
      const built = span("索引");
      flush(0, true);
      for (let i = 0; i < files.length; i++) {
        if (gen !== indexGen) return; // 新しい構築に置き換えられたら中断
        const node = files[i];
        if (store.get(A.contentCacheAtom).get(node.path) === before.get(node.path)) {
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
      built(`${total} 件`);
    },
    [store],
  );

  // quiet：控えの木を出したまま確かめるとき。読み込み中の表示を出さず、
  // 形が変わっていなければ木を置き直さない（開いているフォルダが揺れない）。
  const refreshTree = useCallback(async (opts: { quiet?: boolean } = {}) => {
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
    if (!opts.quiet) {
      store.set(A.loadingAtom, {
        active: true,
        message: "フォルダを読み込み中",
        done: 0,
        total: 0,
      });
    }
    const scan = ++treeGen;
    const walked = span("走査");
    // 時刻は木と同時に取りに行き、索引の前に揃える。読む前の時刻を本文に
    // 付けておけば、次に戻ったとき変わったものだけを読み直せる。
    const ignores = store.get(A.ignoresByRootAtom);
    const stamped = span("更新時刻");
    const stampsOf = Promise.all(
      [...ignores].map(([at, ignore]) => folderMtimes(at, ignore)),
    ).then(
      (parts) => {
        const m = new Map(parts.flatMap((part) => [...part]));
        stamped(`${m.size} 件`);
        return m;
      },
      (e: unknown) => {
        console.error("更新時刻を読めません", e);
        return new Map<string, number>();
      },
    );
    const tree = await scanRoots(store);
    if (scan !== treeGen) return;
    const files = flattenFiles(tree);
    walked(`${files.length} 件`);
    const was = store.get(A.filesAtom);
    if (!opts.quiet || !sameShape(store.get(A.treeAtom), tree)) {
      const laid = span("木を置く");
      store.set(A.treeAtom, tree);
      store.set(A.filesAtom, files);
      laid();
    }
    if (!opts.quiet) {
      store.set(A.loadingAtom, { active: false, message: "", done: 0, total: 0 });
    }
    // 無くなったファイルの本文と時刻を落とす。控えから戻したときは、離れている
    // あいだに消えたものがここで初めて分かる。
    const roots = store.get(A.rootsAtom);
    const present = new Set(files.map((f) => f.path));
    const gone = (path: string) =>
      rootOf(roots, path) !== null && kindOf(path) === "markdown" && !present.has(path);
    const cache = store.get(A.contentCacheAtom);
    if ([...cache.keys()].some(gone)) {
      store.set(A.contentCacheAtom, new Map([...cache].filter(([k]) => !gone(k))));
      store.set(
        A.mtimeCacheAtom,
        new Map([...store.get(A.mtimeCacheAtom)].filter(([k]) => !gone(k))),
      );
    }
    // 開いていたタブのうち、前の一覧にはあって今は無いものは閉じる。
    const vanished = new Set(was.map((f) => f.path).filter((path) => !present.has(path)));
    if (vanished.size > 0) remapLeafPaths(store, (path) => (vanished.has(path) ? null : path));
    // インデックスは全ファイルを読むので、最初の描画と取り合いにならないよう
    // 手が空いてから始める（await もしない）
    const gen = ++indexGen;
    // 索引に入れるのは Markdown だけ。画像や PDF を文字として読んでも中身は
    // 引けないし、大きいものを丸ごと抱えることになる。
    const docs = files.filter((f) => kindOf(f.name) === "markdown");
    void stampsOf.then((stamps) => {
      if (gen !== indexGen) return;
      store.set(A.touchedAtom, stamps);
      // 確かめのときは、すでに手が空いてから走っている。
      if (opts.quiet) void indexContents(docs, gen, stamps);
      else whenIdle(() => void indexContents(docs, gen, stamps));
    });
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
    const scan = ++treeGen;
    const tree = await scanRoots(store);
    if (scan !== treeGen) return;
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
      // 道筋はどれも絶対パス。動いた元と先も、そのまま台帳やアイコンの鍵になる。
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
        const [from, to] = moved;
        const sole = store.get(A.soleAtom);
        if (sole && sole === from) store.set(A.soleAtom, to);
        // 指摘と版は絶対パスで台帳に紐付いている。ここで連れていかないと、
        // 名前を変えた時点でそのファイルの指摘が引けなくなる。
        void moveReviewFile(from, to).then(() => syncLedger(store));
        // フォルダに付けたアイコンも、動いた先（と下のフォルダ）へ連れていく。
        store.set(A.folderIconsAtom, (was) => moveFolderIcons(was, from, to));
      }
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
    store.set(A.recentDocsAtom, await loadDocs());
    // 下書きの置き場は、ここで 1 度だけ求めて覚える。分かるまでは
    // 「下書きかどうか」を判定しない（道筋を人に見せてしまわないように）。
    store.set(A.draftsDirAtom, await draftsDir());
    await refreshWorkspaces(store);
  }, [store]);


  const reloadFile = useCallback(
    async (path: string) => {
      // Markdown 以外は本文を読まない。見せ方は種類ごとの画面が持っていて、
      // 本文は要らない（画像やＰＤＦを文字として読むと化けるだけ）。
      if (kindOf(path) !== "markdown") return;
      // ツリーがまだ無くても読める（道筋は絶対パス）。ウィンドウを開いた直後は
      // フォルダ全体の走査が終わっておらず、待つと本文が出るのが遅れる。
      try {
        const data = await readFile(path);
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
    [store],
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
      const open = new Set(
        (store.get(A.expandedByFolderAtom)[folderId] ?? []).map((p) => absoluteIn(p, folderId)),
      );
      // 根を行として並べているときは、根の行も開く。
      const roots = store.get(A.rootsAtom);
      for (const path of paths) {
        const root = rootOf(roots, path);
        if (!root) continue;
        if (roots.length > 1) open.add(root);
        for (const dir of ancestorPaths(path, root)) open.add(dir);
      }
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
      const cache = store.get(A.contentCacheAtom);
      if (cache.has(sole) && cache.get(sole)!.trim() === "") {
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

  // 根を並べて、タブの並びを当てる。フォルダ・ワークスペースを開く道はここに集まる。
  //
  // 根の並びが今と同じなら走査し直さない。木と本文の控えをそのまま使い、
  // タブの並びだけを差し替える（同じフォルダのワークスペースどうしの切り替えは
  // 待たずに替わる）。
  const enter = useCallback(
    (to: {
      workspace: Workspace | null;
      roots: string[];
      saved?: { layout: StoredNode; active: string };
      file?: string;
    }) => {
      const switched = span("画面を切り替え");
      const wasSole = store.get(A.soleAtom) !== null;
      const same =
        !wasSole &&
        store.get(A.treeAtom).length > 0 &&
        sameList(store.get(A.rootsAtom), to.roots);
      // 離れる根の木と本文を控えておく（戻ってきたとき、その場で描く）。
      if (!same && !wasSole) stashRoots(store, store.get(A.rootsAtom));
      store.set(A.soleAtom, null);
      store.set(A.layoutOwnerAtom, null);
      store.set(A.workspaceAtom, to.workspace);
      const key = to.workspace?.id ?? to.roots[0];
      if (to.workspace?.expanded) {
        const expanded = to.workspace.expanded;
        store.set(A.expandedByFolderAtom, (prev) => ({ ...prev, [key]: expanded }));
      }
      store.set(A.activeFolderIdAtom, to.roots[0]);
      store.set(A.extraRootsAtom, to.roots.slice(1));
      resetLayout(store);
      const lay = () => {
        if (to.saved) {
          const valid = new Set(store.get(A.filesAtom).map((f) => f.path));
          const { layout, active } = reviveLayout(to.saved.layout, valid, to.saved.active);
          store.set(A.layoutAtom, layout);
          store.set(A.activePaneIdAtom, active);
          revealTabs(key, layout);
        }
        // ここからのタブの動きは、このワークスペースの控えに書いてよい。
        store.set(A.layoutOwnerAtom, key);
      };
      // 保存レイアウトがあるとこの後それで置き換わるので、先出しは意味が無い
      if (same) {
        lay();
        if (to.file) openFile(to.file);
        switched();
        opened = Promise.resolve();
        return;
      }
      // 入る根の控えを引き当てる。前の根の本文は控えへ移ったので、ここで
      // 組み直すのは入る根の分だけ（検索に前の根のものが混ざらない）。
      const showOther = store.get(A.showOtherFilesAtom);
      const ignores = store.get(A.ignoresByRootAtom);
      const kept = to.roots.map((root) => takeStash(root, showOther, ignores.get(root) ?? ""));
      const texts = new Map<string, string>();
      const stamps = new Map<string, number>();
      const touched = new Map<string, number>();
      for (const k of kept) {
        if (!k) continue;
        for (const [p, v] of k.texts) texts.set(p, v);
        for (const [p, v] of k.stamps) stamps.set(p, v);
        for (const [p, v] of k.touched) touched.set(p, v);
      }
      store.set(A.contentCacheAtom, texts);
      store.set(A.mtimeCacheAtom, stamps);
      store.set(A.touchedAtom, touched);
      // 全部の根に控えがあれば、それで木を組んでその場でタブまで戻す。
      // 離れているあいだの変化は、手が空いてから確かめて読み直す。
      if (kept.every((k) => k !== null)) {
        const tree = plant(store, to.roots, kept.map((k) => k!.forest));
        store.set(A.treeAtom, tree);
        store.set(A.filesAtom, flattenFiles(tree));
        lay();
        if (to.file) openFile(to.file);
        switched();
        opened = Promise.resolve();
        whenIdle(() => void refreshTree({ quiet: true }));
        return;
      }
      // 前の一覧は、ここで畳む。残したまま走査を待つと、押しても
      // 何も起きていないように見える。
      store.set(A.treeAtom, []);
      store.set(A.filesAtom, []);
      if (to.file && !to.saved) openFile(to.file);
      switched();
      // 走査は待たない。待っているあいだ、画面はどの操作も受け付けなくなる。
      const rootsKey = to.roots.join("\n");
      opened = refreshTree().then(() => {
        // 走査のあいだに別のところへ移っていたら、もう当てる先がない。
        if (
          store.get(A.workspaceAtom)?.id !== to.workspace?.id ||
          store.get(A.rootsAtom).join("\n") !== rootsKey
        ) {
          return;
        }
        lay();
        if (to.file && to.saved) openFile(to.file);
      });
    },
    [store, refreshTree, openFile, revealTabs],
  );

  // ワークスペースを開く。別の窓で開いていれば、その窓を前に出すだけ。
  const openWorkspace = useCallback(
    async (ws: Workspace, opts: { file?: string; force?: boolean } = {}): Promise<void> => {
      if (
        !opts.force &&
        holdDraft(() => void openWorkspaceRef.current?.(ws, { ...opts, force: true }))
      ) {
        return;
      }
      const label = currentWindowLabel();
      if (store.get(A.workspaceAtom)?.id === ws.id) {
        if (opts.file) openFile(opts.file);
        return;
      }
      const elsewhere = await focusWorkspace(ws.id, label).catch(() => false);
      if (elsewhere) return;
      // 今のワークスペースの書きかけの控えを先に書き切る。
      flushWorkspaceSave();
      const now = Math.floor(performance.timeOrigin + performance.now());
      const next: Workspace = { ...ws, lastOpened: now };
      store.set(A.workspacesAtom, (list) => upsertWorkspace(list, next));
      void saveWorkspace(next).catch((e: unknown) => {
        console.error("ワークスペースを控えられません", e);
      });
      void bindWindow(label, next.id).catch((e: unknown) => {
        console.error("窓の控えを書けません", e);
      });
      // ワークスペースの列の末尾に入れ、このウィンドウで開いた順に積む。
      store.set(barAtom, (list) => addToBar(list, next.id));
      store.set(visitedAtom, (list) => visit(list, next.id));
      enter({
        workspace: next,
        roots: next.roots,
        saved: next.layout ? { layout: next.layout, active: next.active ?? "" } : undefined,
        file: opts.file,
      });
    },
    [store, holdDraft, openFile, enter],
  );
  const openWorkspaceRef = useRef(openWorkspace);
  openWorkspaceRef.current = openWorkspace;

  // フォルダを開く。そのフォルダのワークスペースを開く（無ければ作る）。
  // file を渡すと、そのファイルはツリーの走査を待たずに出す。
  //
  // only を渡すと「そのファイルだけの窓」として開く。ワークスペースにはせず、
  // 控えのタブも使わない（別の窓へ引き出したファイルを、その窓で開き直すため）。
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
      // 履歴への登録は画面を進めてからでよい。待つと、押してから何も変わらない
      // 間ができる。Dock メニューから読めるよう Rust 側にも残す。
      void registerFolder(path, now).then((list) => store.set(A.foldersAtom, list));
      void recordRecentFolder(path, now).catch((e: unknown) => {
        console.error("最近開いたフォルダを記録できません", e);
      });
      const file = opts.file && absoluteIn(opts.file, path);
      if (opts.only) {
        flushWorkspaceSave();
        void bindWindow(currentWindowLabel(), null).catch(() => {});
        enter({ workspace: null, roots: [path], file });
        return;
      }
      const ws = await folderWorkspace(store, path, now);
      await openWorkspace(ws, { file, force: true });
    },
    [store, holdDraft, enter, openWorkspace],
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
      // 1 枚だけのときはワークスペースにしない（控えを残さない）。
      flushWorkspaceSave();
      // 並べていた根は控えておく（ワークスペースへ戻ったとき読み直さない）。
      if (store.get(A.soleAtom) === null) stashRoots(store, store.get(A.rootsAtom));
      store.set(A.workspaceAtom, null);
      store.set(A.layoutOwnerAtom, null);
      void bindWindow(currentWindowLabel(), null).catch(() => {});
      store.set(A.soleAtom, abs);
      store.set(A.activeFolderIdAtom, root);
      store.set(A.extraRootsAtom, []);
      resetLayout(store);
      store.set(A.contentCacheAtom, new Map());
      store.set(A.mtimeCacheAtom, new Map());
      store.set(A.touchedAtom, new Map());
      store.set(A.treeAtom, [node]);
      store.set(A.filesAtom, [node]);
      openFile(abs);

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
      // そのファイルが属する根を渡す（根を並べているとき、最初の根とは限らない）。
      // 根の外のファイルなら、その親フォルダで開く。
      const folderId =
        (path && rootOf(store.get(A.rootsAtom), path)) ??
        (path ? dirOf(path) : store.get(A.activeFolderIdAtom));
      if (!folderId) return false;
      const entry = store.get(A.foldersAtom).find((f) => f.id === folderId);
      const title = entry ? folderDisplayName(entry) : baseOf(folderId) || "fude";
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
  // そのフォルダのワークスペースを開いている窓があれば、その窓を前に出す。
  const openFolderInNewWindow = useCallback(
    async (folderId: string, title: string): Promise<boolean> => {
      try {
        const now = Math.floor(performance.timeOrigin + performance.now());
        const ws = await folderWorkspace(store, folderId, now);
        if (await focusWorkspace(ws.id, "").catch(() => false)) return true;
        await openWorkspaceWindow(ws.id, ws.name || title);
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

  // 文書から書かれた道筋を絶対パスに解く。頭が / なら、その文書の根から。
  // 根より上へは出ない。根の外の文書は、その文書のフォルダを根として扱う。
  const resolveFrom = useCallback(
    (fromDocPath: string, href: string): string | null => {
      const root = rootFor(fromDocPath) ?? dirOf(fromDocPath);
      if (!root) return null;
      const rel = fromDocPath.slice(root.length + 1);
      const inside = resolvePath(dirOf(rel), href);
      return inside ? joinPath(root, inside) : null;
    },
    [rootFor],
  );

  const navigate = useCallback(
    (fromDocPath: string, href: string) => {
      // 断片（#見出し）は道筋の一部ではない。付けたまま解こうとすると、
      // どのファイルにも一致せず黙って何も起きない。
      const { path, id } = splitHref(href);
      // 当てる先は、そのファイルが描き終わってから。開く側は置くだけにする。
      const aim = (at: string) => {
        if (!id) return;
        store.set(A.pendingAnchorAtom, (was) => ({
          path: at,
          id,
          nonce: (was?.nonce ?? 0) + 1,
        }));
      };
      const here = (at: string) => store.get(A.filesAtom).some((f) => f.path === at);

      // 1. ファイル系の絶対パスとして見る。開いているフォルダの中ならそのまま開く。
      if (here(path)) {
        openFile(path);
        aim(path);
        return;
      }

      // 2. 書いたファイルの根の中の道筋として解く（相対も、根からの / も）。
      const target = resolveFrom(fromDocPath, path);
      if (target) {
        const found = here(target) ? target : here(`${target}.md`) ? `${target}.md` : null;
        if (found) {
          openFile(found);
          aim(found);
          return;
        }
      }

      // 3. フォルダの外なら、1 枚だけ開く。
      if (path.startsWith("/")) {
        openDocRef.current?.(path);
        aim(path);
        return;
      }

      notify(store, "そのファイルは見つかりません");
    },
    [store, openFile, resolveFrom],
  );

  // 相対パス資産（画像など）: キャッシュ済み blob URL を同期取得。
  const peekAsset = useCallback(
    (fromDocPath: string, src: string): string | null => {
      const full = resolveFrom(fromDocPath, src);
      return full ? peekImageUrl(full) : null;
    },
    [resolveFrom],
  );

  // 画像を fs 経由で読み blob URL 化（非同期）。
  const resolveAsset = useCallback(
    async (fromDocPath: string, src: string): Promise<string | null> => {
      const full = resolveFrom(fromDocPath, src);
      return full ? imageUrl(full) : null;
    },
    [resolveFrom],
  );

  // ---- ファイル操作（Obsidian 風の編集機能） ----
  // 道筋はどれも絶対パス。行き先のフォルダも絶対パスで受ける。
  // 一意な名前を作る（重複時に連番）。
  const uniquePath = useCallback(async (path: string): Promise<string> => {
    if (!(await pathExists(path))) return path;
    const dir = dirOf(path);
    const base = baseOf(path);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
      const cand = joinPath(dir, `${stem} ${i}${ext}`);
      if (!(await pathExists(cand))) return cand;
    }
    return path;
  }, []);

  const createFile = useCallback(
    async (parentDir: string, name: string) => {
      let fileName = name.trim();
      if (!fileName) return;
      if (!/\.[a-z0-9]+$/i.test(fileName)) fileName += ".md";
      const path = await uniquePath(joinPath(parentDir, fileName));
      // 中身は空で作る。名前を見出しとして入れると、要らない人は毎回消すことになる。
      await writeFile(path, "");
      const content = new Map(store.get(A.contentCacheAtom));
      content.set(path, "");
      store.set(A.contentCacheAtom, content);
      await refreshTreeStructure();
      store.set(A.freshFileAtom, path);
      openFile(path);
    },
    [uniquePath, refreshTreeStructure, openFile, store],
  );

  const createFolder = useCallback(
    async (parentDir: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      const path = await uniquePath(joinPath(parentDir, n));
      await createDir(path);
      await refreshTreeStructure();
    },
    [uniquePath, refreshTreeStructure],
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
    // 名前を変えた後の道筋を返す。変えなかったときは元の道筋。
    async (path: string, newName: string, isDir: boolean): Promise<string> => {
      const trimmed = newName.trim();
      if (!trimmed) return path;
      let base = trimmed;
      if (!isDir && !/\.[a-z0-9]+$/i.test(base)) base += ".md";
      const next = joinPath(dirOf(path), base);
      if (next === path) return path;
      await renamePath(path, next);
      await applyPathRemap(remapper(path, next), [path, next]);
      return next;
    },
    [applyPathRemap],
  );

  const deleteEntry = useCallback(
    async (path: string, isDir: boolean) => {
      await removePath(path, isDir);
      if (isDir) store.set(A.folderIconsAtom, (was) => dropFolderIcons(was, path));
      const gone = (p: string | null) =>
        p === path || (p && p.startsWith(path + "/")) ? null : p;
      remapLeafPaths(store, gone);
      remapCache((p) => gone(p) ?? null);
      await refreshTreeStructure();
    },
    [store, refreshTreeStructure, remapCache],
  );

  const moveEntry = useCallback(
    async (path: string, destDir: string) => {
      if (
        path === destDir ||
        destDir.startsWith(path + "/") ||
        dirOf(path) === destDir
      )
        return;
      const next = await uniquePath(joinPath(destDir, baseOf(path)));
      await renamePath(path, next);
      await applyPathRemap(remapper(path, next), [path, next]);
    },
    [uniquePath, applyPathRemap],
  );

  // 外から落とされたものを、フォルダの中へ写す。元は動かさない。
  //
  // 空きを採り直すのは頭の名前だけ。中まで一つずつ採ると、落としたフォルダの
  // 形が崩れる（中で重なるものは、そもそも新しい場所に入るので重ならない）。
  const intake = useCallback(
    async (destDir: string, brought: Brought[]) => {
      if (brought.length === 0 || !destDir) return;

      const heads = new Map<string, string>();
      for (const { rel } of brought) {
        const head = rel.split("/")[0];
        if (heads.has(head)) continue;
        heads.set(head, baseOf(await uniquePath(joinPath(destDir, head))));
      }
      const targets = brought.map(({ rel, file }) => {
        const [head, ...rest] = rel.split("/");
        return {
          path: joinPath(destDir, [heads.get(head) ?? head, ...rest].join("/")),
          file,
        };
      });
      const files = targets.filter((t) => t.file);

      const at = notifyBusy(store, `${targets.length} 件を取り込んでいます…`);
      try {
        // 場所を先に作る。浅いものから作るので、親の無いところへは書かない。
        const dirs = [
          ...new Set(targets.map((t) => (t.file ? dirOf(t.path) : t.path))),
        ]
          .filter((dir) => dir !== destDir)
          .sort();
        for (const dir of dirs) await createDir(dir);
        await inTurn(files, WRITE_AT_ONCE, async (t) => {
          if (!t.file) return;
          await writeBytes(t.path, new Uint8Array(await t.file.arrayBuffer()));
        });
        await refreshTreeStructure();

        // 入れたのに一覧に出ないときは、そのわけを添える。落ちたのか弾かれた
        // のか分からないまま終わるのがいちばん困る。
        const shown = new Set(store.get(A.filesAtom).map((f) => f.path));
        const buried =
          files.length > 0 && !files.some((t) => shown.has(t.path));
        settle(
          store,
          at,
          buried
            ? `${targets.length} 件を取り込みました（設定の「Markdown 以外も並べる」を入にすると一覧に出ます）`
            : `${targets.length} 件を取り込みました`,
        );
      } catch (e) {
        settle(store, at, "取り込めませんでした");
        void message(`取り込めませんでした。\n${String(e)}`, {
          title: "fude",
          kind: "error",
        });
      }
    },
    [uniquePath, refreshTreeStructure, store],
  );

  // 履歴を積まずにキャッシュ＋ディスクへ書く（undo/redo の実体）。
  const writeContent = useCallback(
    async (path: string, text: string) => {
      // 先にキャッシュを更新（楽観的）＝ UI を即反映し、ブロック削除時に一瞬
      // 元内容が再表示される「がくっ」を防ぐ。書き込みは後追い。
      const content = new Map(store.get(A.contentCacheAtom));
      content.set(path, text);
      store.set(A.contentCacheAtom, content);
      await writeFile(path, text);
    },
    [store],
  );

  // checkpoint: 文書全体の Undo に 1 段積むか。自動保存は積まない
  // （0.5 秒ごとに 1 段になると、⌘Z が実質使えなくなる）。
  const saveFile = useCallback(
    async (path: string, text: string, opts?: { checkpoint?: boolean }) => {
      if (opts?.checkpoint !== false) {
        const prev = store.get(A.contentCacheAtom).get(path);
        if (prev !== undefined && prev !== text) {
          const h = histFor(path);
          h.undo.push(prev);
          if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
          h.redo = [];
        }
      }
      await writeContent(path, text);
    },
    [store, writeContent],
  );

  // ドキュメント全体の Undo/Redo（編集確定後に 1 ステップ単位で巻き戻す）。
  const undoFile = useCallback(
    async (path: string) => {
      const h = contentHistory.get(path);
      if (!h || h.undo.length === 0) return false;
      const cur = store.get(A.contentCacheAtom).get(path) ?? "";
      const prev = h.undo.pop() as string;
      h.redo.push(cur);
      await writeContent(path, prev);
      return true;
    },
    [store, writeContent],
  );

  const redoFile = useCallback(
    async (path: string) => {
      const h = contentHistory.get(path);
      if (!h || h.redo.length === 0) return false;
      const cur = store.get(A.contentCacheAtom).get(path) ?? "";
      const next = h.redo.pop() as string;
      h.undo.push(cur);
      await writeContent(path, next);
      return true;
    },
    [store, writeContent],
  );

  return {
    getRootPath,
    rootFor,
    refreshFolders,
    openFolder,
    openWorkspace,
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
    intake,
    saveFile,
    undoFile,
    redoFile,
  };
}
