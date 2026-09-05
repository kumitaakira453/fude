import { useAtom, useAtomValue, useStore } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DocSearchOverlay } from "./DocSearchOverlay";
import { useReview } from "../hooks/useReview";
import { useWorkspace } from "../hooks/useWorkspace";
import { fontStack } from "../lib/fonts";
import {
  blockIndexOf,
  blockRect,
  selectTextIn,
  topmostBlock,
} from "../lib/domText";
import { blocksOf } from "../lib/blocks";
import { parseFrontmatter } from "../lib/frontmatter";
import { closePane, inEditable } from "../lib/ui";
import { notify, notifyBusy, settle } from "../state/toast";
import {
  activePath,
  activePaneIdAtom,
  contentCacheAtom,
  editorialAtom,
  fontAtom,
  paletteOpenAtom,
  readingWidthAtom,
  settingsOpenAtom,
  shortcutsOpenAtom,
  tocOpenAtom,
  watchModeAtom,
  type Pane,
} from "../state/atoms";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { Breadcrumbs } from "./Breadcrumbs";
import { EditableBody } from "./EditableBody";
import { Frontmatter } from "./Frontmatter";
import { Icon } from "./Icon";
import { markdownContext } from "./MarkdownContext";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  recallViewpoint,
  rememberViewpoint,
  viewKey,
} from "../lib/viewpoint";
import { AnchorOverlay } from "./review/AnchorOverlay";
import { CommentComposer } from "./review/CommentComposer";
import { Toc } from "./Toc";
import { Tooltip } from "./Tooltip";

const WIDTH_CLASS: Record<string, string> = {
  cozy: "max-w-[760px]",
  wide: "max-w-[1000px]",
  full: "max-w-none",
};

export function DocPane({ pane, isSplit }: { pane: Pane; isSplit: boolean }) {
  const cache = useAtomValue(contentCacheAtom);
  const font = useAtomValue(fontAtom);
  const width = useAtomValue(readingWidthAtom);
  const editorial = useAtomValue(editorialAtom);
  const tocOpen = useAtomValue(tocOpenAtom);
  const watchMode = useAtomValue(watchModeAtom);
  const [activeId, setActiveId] = useAtom(activePaneIdAtom);
  // 重ねた画面が出ているか。本文向けのキー操作をそこへ効かせないための判定。
  const settingsOpen = useAtomValue(settingsOpenAtom);
  const shortcutsOpen = useAtomValue(shortcutsOpenAtom);
  const paletteOpen = useAtomValue(paletteOpenAtom);
  const overlayOpen = settingsOpen || shortcutsOpen || paletteOpen;
  const store = useStore();
  const {
    absOf,
    navigate,
    resolveAsset,
    peekAsset,
    reloadFile,
    saveFile,
    undoFile,
    redoFile,
  } = useWorkspace();

  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  // 進捗バーはスクロール毎に DOM へ直接反映する。
  // （React 再描画 + CSS transition を挟むと遅延してむしろ煩わしいため）
  const progressRef = useRef<HTMLDivElement>(null);
  const setBar = (frac: number) => {
    if (progressRef.current) progressRef.current.style.width = `${frac * 100}%`;
  };
  // 見ていた場所はプレビュー・全文編集・レビュー画面の行き帰りで引き継ぐ。
  // 控えはコンポーネントの外（lib/viewpoint）に置く。レビュー画面は本文の木を
  // 丸ごと差し替えるので、ここに持つと戻ってきた時点で消えていて先頭に戻る。
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // フロントマター（先頭の --- ブロック）をその場編集中か（開始時のクリック座標）
  // 選択メニューの「編集する」から立てる編集の頼み。
  const [editRequest, setEditRequest] = useState<{
    // どのファイルへの頼みか。ファイルを切り替えると本文の中身も番号も
    // 変わるので、別のファイルに残った頼みは効かせない。
    path: string;
    blockIndex: number;
    // 表のセル・箇条書きの項目を選んでいるときは、その要素のソースオフセット。
    // どちらでもなければ両方 undefined で、ブロック全体の編集になる。
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null>(null);
  const [editingFm, setEditingFm] = useState<{ x: number; y: number } | null>(
    null,
  );

  const isActive = activeId === pane.id;
  const path = activePath(pane);
  const raw = path ? cache.get(path) : undefined;

  // 本文が未読込のあいだはローディングを出す。ただし一瞬で読める場合に
  // ちらつかせないよう、遅延してから表示する（読めたら即座に消す）。
  const loaded = !!path && raw !== undefined;
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!path || loaded) {
      setShowLoading(false);
      return;
    }
    const t = window.setTimeout(() => setShowLoading(true), 180);
    return () => window.clearTimeout(t);
  }, [path, loaded]);

  const enterEdit = () => {
    // 今見ている場所を控えて、そこから編集を始められるようにする。
    rememberViewpoint(viewKey(pane.id, path), viewAt());
    setDraft(raw ?? "");
    setEditing(true);
  };
  const save = () => {
    if (path) void saveFile(path, draft);
  };
  const exitEdit = () => {
    if (path && draft !== (raw ?? "")) void saveFile(path, draft);
    // 戻ったときに合わせるブロックまでを、最初の描画で出させる。
    setStartAt(restoreIndex() ?? 0);
    setEditing(false);
  };
  const toggleEdit = () => (editing ? exitEdit() : enterEdit());
  // キー操作から呼ぶための控え。listener の依存に本文の要素（後から入る）を
  // 載せないと、それが無い時点の関数を掴んだままになり、見ていた場所を
  // 取れずに先頭から開いてしまう。
  const toggleRef = useRef(toggleEdit);
  toggleRef.current = toggleEdit;

  // ファイル切替で編集モード解除
  useEffect(() => {
    setEditing(false);
    setEditingFm(null);
  }, [path]);

  // ドキュメント全体の Undo/Redo（アクティブペインのみ、CM 編集中は CM に任せる）
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "z" && e.key !== "Z")) return;
      // 編集中の入力欄（CodeMirror・セルのインライン textarea 等）では、
      // その入力欄自身のネイティブ undo を優先し、ドキュメント全体の undo は行わない
      if (inEditable(e.target)) return;
      if (!path) return;
      e.preventDefault();
      // 指摘を消した直後は、それを戻す。消したものが無ければ本文へ譲る。
      if (!e.shiftKey && reviewRef.current?.undoRemove()) return;
      // 本文全体を読み直すので間があく。何が起きているかを知らせで出す。
      const back = !e.shiftKey;
      const id = notifyBusy(store, back ? "戻しています" : "やり直しています", "right");
      void (back ? undoFile(path) : redoFile(path)).then((ok) => {
        settle(
          store,
          id,
          ok
            ? back
              ? "戻しました"
              : "やり直しました"
            : back
              ? "これ以上戻せません"
              : "やり直せる変更がありません",
        );
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, path, undoFile, redoFile, store]);

  // ⌘E で編集/プレビュー切替（アクティブペインのみ）。
  // 本文を選んでいるときは「選んだところを編集する」に譲る。同じキーで
  // 両方が走ると、その場編集と全文編集が同時に開く。
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
        if (reviewRef.current?.selection) return;
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive]);

  const { data, body } = useMemo(() => parseFrontmatter(raw ?? ""), [raw]);
  const absPath = useMemo(() => (path ? absOf(path) : null), [path, absOf]);
  const review = useReview({ absPath, body, raw, content, isActive });
  // キー操作から今の選択を読むための控え。毎描画で作り直さずに済む。
  const reviewRef = useRef(review);
  reviewRef.current = review;

  // 最新の raw/body/path を ref で参照し、saveBody を安定な関数に保つ。
  // （背景索引などで再レンダーしても Markdown のメモ化が壊れず、Mermaid の
  //  再パース＝チカチカを防ぐ）
  const rawRef = useRef(raw);
  const bodyRef = useRef(body);
  const pathRef = useRef(path);
  rawRef.current = raw;
  bodyRef.current = body;
  pathRef.current = path;

  // ブロック編集の確定: body を差し戻し、フロントマターを保ったまま全文保存する。
  // body は raw の suffix なので、先頭の frontmatter 部分を prefix として復元する。
  const saveBody = useCallback(
    (newBody: string) => {
      const p = pathRef.current;
      if (!p) return;
      const full = rawRef.current ?? "";
      const prefix = full.slice(0, full.length - bodyRef.current.length);
      void saveFile(p, prefix + newBody);
    },
    [saveFile],
  );

  // ブロック全体への指摘。つまみのメニューから呼ぶ。選択を持たない操作なので、
  // そのブロックの中身を選んでから通常の指摘の流れに乗せる。
  const commentOnBlock = useCallback(
    (index: number) => {
      if (!content) return;
      const el = content.querySelector<HTMLElement>(
        `[data-mg-block="${index}"]`,
      );
      if (!el) return;
      if (selectTextIn(el)) {
        reviewRef.current?.startDraft({ whole: true });
        return;
      }
      // 図のように選べる文字を持たないブロック。枠そのものを対象にする。
      const rect = blockRect(el) ?? el.getBoundingClientRect();
      reviewRef.current?.startDraft({
        whole: true,
        at: { blockIndex: index, start: 0, end: 0, text: "", rect },
      });
    },
    [content],
  );

  // 指摘を書いている間、対象のブロックが今どこに居るかを測る。小窓は
  // 動いた分だけ一緒に動く。
  // 小窓が居てよい範囲。分割しているときに隣のペインやタブ帯へはみ出さない。
  const draftArea = useCallback(() => {
    const el = scroller ?? content;
    return el ? el.getBoundingClientRect() : null;
  }, [scroller, content]);

  const trackDraft = useCallback(() => {
    const at = reviewRef.current?.draft?.blockIndex;
    if (!content || at === undefined) return null;
    const el = content.querySelector<HTMLElement>(`[data-mg-block="${at}"]`);
    if (!el) return null;
    const box = blockRect(el) ?? el.getBoundingClientRect();
    return { top: box.top, left: box.left };
  }, [content]);

  // 箇条書きの項目への指摘。項目の中身を選んでから通常の流れに乗せるので、
  // 印はその項目の箱で出る。
  const commentOnItem = useCallback(
    (index: number, anchor: number) => {
      const el = content?.querySelector<HTMLElement>(
        `[data-mg-block="${index}"] li[data-mg-item="${anchor}"]`,
      );
      if (!el || !selectTextIn(el)) return;
      reviewRef.current?.startDraft({ unit: true });
    },
    [content],
  );

  // セル全体への指摘。セルの中を選んでいるときだけ使える。選択をセルの
  // 中身へ広げてから通常の流れに乗せるので、印はセルの箱で出る。
  const commentOnCell = useCallback(() => {
    const sel = reviewRef.current?.selection;
    if (!content || !sel || sel.cellStart === undefined) return;
    const cell = content.querySelector<HTMLElement>(
      `[data-mg-block="${sel.blockIndex}"] [data-mg-cell="${sel.cellStart}"]`,
    );
    if (!cell || !selectTextIn(cell)) return;
    reviewRef.current?.startDraft({ unit: true });
  }, [content]);

  // 選択したところを消す頼み。ソースのどこを切るかは EditableBody が出す。
  const [deleteRequest, setDeleteRequest] = useState<{
    path: string;
    blockIndex: number;
    start: number;
    text: string;
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null>(null);

  const deleteSelection = useCallback(() => {
    const sel = reviewRef.current?.selection;
    const p = pathRef.current;
    if (!sel || !p) return;
    // またいだ選択は扱わない。見えている選択と消える範囲が食い違う。
    if (sel.endBlockIndex !== undefined) {
      notify(store, "ブロックをまたいだ選択は消せません", "right");
      return;
    }
    setDeleteRequest((r) => ({
      path: p,
      blockIndex: sel.blockIndex,
      start: sel.start,
      text: sel.text,
      cellStart: sel.cellStart,
      itemAnchor: sel.itemAnchor,
      nonce: (r?.nonce ?? 0) + 1,
    }));
    window.getSelection()?.removeAllRanges();
    reviewRef.current?.clearSelection();
  }, [store]);

  // 選択したところに対する 2 つの操作。メニューとキーの両方から呼ぶ。
  const startEdit = useCallback(() => {
    const sel = reviewRef.current?.selection;
    const p = pathRef.current;
    if (!sel || !p) return;
    // またいだ選択は扱わない。先頭のブロックだけを開くと、選んだ範囲と
    // 直す範囲が食い違う。
    if (sel.endBlockIndex !== undefined) {
      notify(store, "ブロックをまたいだ選択は編集できません", "right");
      return;
    }
    setEditRequest((r) => ({
      path: p,
      blockIndex: sel.blockIndex,
      cellStart: sel.cellStart,
      itemAnchor: sel.itemAnchor,
      nonce: (r?.nonce ?? 0) + 1,
    }));
    // 選択を解いてメニューを閉じる。selectionchange は 1 フレーム遅れて
    // 届くので、控えの方も同時に落として待たせない。
    window.getSelection()?.removeAllRanges();
    reviewRef.current?.clearSelection();
  }, [store]);

  // 選択したところへのキー操作。メニューを出さずに同じことができる。
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const current = reviewRef.current;
      const sel = current?.selection;
      if (!current || !sel || current.draft) return;
      // 選択したところを消す。入力欄の中の削除はそのまま入力欄に任せる。
      // ⌫ の既定動作（WKWebView の「戻る」）は useHotkeys が止めている。
      // 重ねた画面（設定・一覧・パレット）が出ているあいだは、本文に残った
      // 選択へ効かせない。
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !inEditable(e.target) &&
        !overlayOpen
      ) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "i" && !e.shiftKey) {
        e.preventDefault();
        current.startDraft();
      } else if (key === "i" && e.shiftKey) {
        // 範囲を広げた指摘。セルの中ならそのセル、箇条書きならその項目、
        // それ以外はブロック全体。
        e.preventDefault();
        if (sel.cellStart !== undefined) commentOnCell();
        else if (sel.itemAnchor !== undefined)
          commentOnItem(sel.blockIndex, sel.itemAnchor);
        else commentOnBlock(sel.blockIndex);
      } else if (key === "e" && !e.shiftKey) {
        e.preventDefault();
        startEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isActive,
    startEdit,
    commentOnCell,
    commentOnBlock,
    commentOnItem,
    deleteSelection,
    overlayOpen,
  ]);

  // 頼みは 1 回で使い切る。残しておくと、本文の入れ物が組み直されたとき
  // （全文編集から戻ったときなど）にもう一度効いてしまう。編集なら勝手に
  // その場編集が開き、削除なら同じ削除がもう一度走る。
  // 子の layout effect のあとに走るので、渡し損ねることはない。
  useLayoutEffect(() => {
    if (editRequest) setEditRequest(null);
  }, [editRequest]);
  useLayoutEffect(() => {
    if (deleteRequest) setDeleteRequest(null);
  }, [deleteRequest]);

  // 削除の知らせ。消す前の本文を受け取ったときだけ取り消しを出す。
  const undoDelete = useCallback(
    (previousBody: string | null, text: string) => {
      notify(
        store,
        text,
        "right",
        previousBody === null
          ? undefined
          : { label: "元に戻す", run: () => saveBody(previousBody) },
      );
    },
    [store, saveBody],
  );

  // フロントマター（本文の前にある --- ブロック）の生ソース
  const fmPrefix = (raw ?? "").slice(0, (raw ?? "").length - body.length);
  const saveFm = (newFm: string) => {
    if (!path || newFm === fmPrefix) return;
    void saveFile(path, newFm + body);
  };

  // path はあるが未読込なら読み込む
  useEffect(() => {
    if (path && !cache.has(path)) void reloadFile(path);
  }, [path, cache, reloadFile]);

  // いま画面の上端にあるブロックの、本文の中での位置。
  const viewAt = useCallback((): number => {
    if (!content || !scroller) return 0;
    const el = topmostBlock(content, scroller.getBoundingClientRect().top);
    const at = el ? blockIndexOf(el) : null;
    if (at === null) return 0;
    const block = blocksOf(bodyRef.current)[at];
    if (!block) return 0;
    const prefix = (rawRef.current ?? "").length - bodyRef.current.length;
    return prefix + block.start;
  }, [content, scroller]);

  // 読書プログレス + 見ていた場所の保存。
  // 重要: マウント時に即時実行しない。まだ復元前で scrollTop=0 のため、
  // 先頭を保存してしまい「切替のたびに先頭へ」戻る原因になる。
  // 保存は実際のスクロール操作時のみ行う。
  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      setBar(max > 0 ? Math.min(1, scroller.scrollTop / max) : 0);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        rememberViewpoint(viewKey(pane.id, path), viewAt());
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [scroller, pane.id, path, viewAt]);

  // 控えの位置が本文の何番目のブロックか。復帰の合わせ先に使う。
  // memo にしない（控えは外に置いてあるので、描画のたびに見直さないと古い値を使う）。
  const restoreIndex = useCallback((): number | null => {
    const saved = recallViewpoint(viewKey(pane.id, path));
    if (saved <= 0) return null;
    const prefix = (rawRef.current ?? "").length - bodyRef.current.length;
    const at = saved - prefix;
    const hit = blocksOf(bodyRef.current).findIndex((b) => b.end > at);
    return hit < 0 ? null : hit;
  }, [pane.id, path]);

  // 漸進描画をどこまで先に出すか。プレビューに戻る時点で決める（描画より前に
  // 決まっていないと、合わせ先のブロックがまだ無い）。
  const [startAt, setStartAt] = useState(0);

  // 本文が出たとき: 同じファイルなら見ていた場所のブロックを上端へ、
  // 別ファイルなら先頭へ。描き終わる前に合わせるので、先頭が一瞬見えて
  // からスクロールしていく動きにはならない。
  useLayoutEffect(() => {
    if (editing || !scroller || !content) return;
    const at = restoreIndex();
    if (at === null) {
      scroller.scrollTop = 0;
      return;
    }
    // 画像や KaTeX で後から高さが変わるので、数フレーム押さえる。
    // 自分でスクロールしたらそこで打ち切る。
    let settled = false;
    let left = 12;
    let raf = 0;
    const apply = () => {
      if (settled) return;
      const el = content.querySelector<HTMLElement>(`[data-mg-block="${at}"]`);
      const box = el ? blockRect(el) : null;
      if (box) {
        const delta = box.top - scroller.getBoundingClientRect().top;
        if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
      }
      if (--left > 0) raf = requestAnimationFrame(apply);
    };
    const stop = () => {
      settled = true;
    };
    apply();
    raf = requestAnimationFrame(apply);
    scroller.addEventListener("wheel", stop, { passive: true, once: true });
    scroller.addEventListener("touchstart", stop, { passive: true, once: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("touchstart", stop);
    };
  }, [path, editing, scroller, content, restoreIndex, startAt]);


  const ctx = useMemo(
    () => ({
      docPath: path ?? "",
      onNavigate: (href: string) => path && navigate(path, href),
      resolveAsset: (src: string) => resolveAsset(path ?? "", src),
      peekAsset: (src: string) => peekAsset(path ?? "", src),
      onEditBlock: (blockIndex: number) => {
        const p = pathRef.current;
        if (!p) return;
        setEditRequest((r) => ({
          path: p,
          blockIndex,
          nonce: (r?.nonce ?? 0) + 1,
        }));
      },
    }),
    [path, navigate, resolveAsset, peekAsset],
  );

  const doClosePane = () => closePane(store, pane.id);

  return (
    <section
      onMouseDown={() => !isActive && setActiveId(pane.id)}
      className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${
        isSplit && isActive
          ? "ring-1 ring-inset ring-[var(--mg-accent)]/40"
          : ""
      }`}
    >
      {/* ヘッダー */}
      <header className="flex items-center gap-2 border-b border-[var(--mg-border)] bg-[var(--mg-panel)]/80 px-4 py-2 backdrop-blur">
        <div className="min-w-0 flex-1 truncate text-[12px] text-[var(--mg-muted)]">
          <Breadcrumbs path={path} paneId={pane.id} />
        </div>
        <Tooltip
          align="end"
          label={
            watchMode === "observer"
              ? "変更をリアルタイム監視中"
              : watchMode === "polling"
                ? "変更を監視中（ポーリング）"
                : "監視は停止中"
          }
        >
          <span
            className={`h-2 w-2 shrink-0 cursor-help rounded-full ${
              watchMode === "observer"
                ? "bg-emerald-400"
                : watchMode === "polling"
                  ? "bg-amber-400"
                  : "bg-zinc-500"
            }`}
          />
        </Tooltip>
        {path && (
          <button
            onClick={toggleEdit}
            title={editing ? "プレビュー (⌘E)" : "全文編集 (⌘E) ／ 本文はダブルクリックでその場編集"}
            className={`grid h-6 w-6 place-items-center rounded transition hover:bg-[var(--mg-hover)] ${
              editing
                ? "text-[var(--mg-accent)]"
                : "text-[var(--mg-muted)] hover:text-[var(--mg-fg)]"
            }`}
          >
            <Icon
              name={editing ? "visibility" : "edit"}
              size={15}
              fill={editing}
            />
          </button>
        )}
        {isSplit && (
          <button
            onClick={doClosePane}
            title="このペインを閉じる"
            className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </header>

      {/* 読書プログレスバー */}
      <div className="h-0.5 w-full bg-transparent">
        <div
          ref={progressRef}
          className="h-full bg-[var(--mg-accent)]"
          style={{ width: 0 }}
        />
      </div>

      {/* 本文 + 目次 */}
      <div className="flex min-h-0 flex-1">
        {editing && path ? (
          <MarkdownEditor
            key={path}
            initialDoc={draft}
            onChange={setDraft}
            onSave={save}
            initialOffset={recallViewpoint(viewKey(pane.id, path))}
            onOffset={(offset) => {
              rememberViewpoint(viewKey(pane.id, path), offset);
            }}
          />
        ) : (
          <div
            ref={setScroller}
            className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            {path && !loaded ? (
              <div className="px-10 py-8 sm:px-16">
                {showLoading && (
                  <div className={`${WIDTH_CLASS[width]} mx-auto`}>
                    <LoadingBody />
                  </div>
                )}
              </div>
            ) : path ? (
              <div className="px-10 py-8 sm:px-16">
                <article
                  ref={setContent}
                  style={{ fontFamily: fontStack(font) }}
                  className={`mg-prose prose ${
                    editorial ? "mg-editorial" : ""
                  } ${WIDTH_CLASS[width]} mx-auto`}
                >
                  {data &&
                    (editingFm ? (
                      <BlockSourceEditor
                        src={fmPrefix}
                        clickX={editingFm.x}
                        clickY={editingFm.y}
                        onCommit={(s) => {
                          setEditingFm(null);
                          saveFm(s);
                        }}
                        onCancel={() => setEditingFm(null)}
                      />
                    ) : (
                      <div
                        className="mg-block"
                        onDoubleClick={(e) =>
                          setEditingFm({ x: e.clientX, y: e.clientY })
                        }
                      >
                        <Frontmatter data={data} />
                      </div>
                    ))}
                  <markdownContext.Provider value={ctx}>
                    {/* 選択メニューやつまみから、そのブロックだけを生ソース編集 */}
                    {/* key でファイルごとに貼り替え、漸進描画を先頭からやり直す */}
                    <EditableBody
                      key={path}
                      body={body}
                      editorial={editorial}
                      onSaveBody={saveBody}
                      editRequest={editRequest}
                      deleteRequest={deleteRequest}
                      onDeleted={undoDelete}
                      startIndex={startAt}
                      content={content}
                      scroller={scroller}
                      contentKey={path}
                      onComment={commentOnBlock}
                      onCommentItem={commentOnItem}
                    />
                  </markdownContext.Provider>
                </article>
              </div>
            ) : (
              <EmptyPane />
            )}
          </div>
        )}

        {!editing && !isSplit && tocOpen && path && (
          <Toc
            content={content}
            scroller={scroller}
            contentKey={path + (raw?.length ?? 0)}
          />
        )}

        {!editing && path && (
          <AnchorOverlay
            content={content}
            threads={review.threads}
            resolutions={review.resolutions}
            contentKey={path + (raw?.length ?? 0)}
            draft={
              review.draft
                ? {
                    blockIndex: review.draft.blockIndex,
                    offset: review.draft.offset,
                    length: review.draft.text.length,
                    // またいだ指摘は箇所を線で示せないので、覆っている
                    // ブロックの枠で出す。
                    whole:
                      review.draft.whole || review.draft.until !== undefined,
                    until: review.draft.until,
                    // セル・項目を丸ごと対象にしたときの引き先。行ごとの
                    // 矩形ではなくこの箱で示す。
                    unit: !review.draft.unit
                      ? undefined
                      : review.draft.itemAnchor !== undefined
                        ? `li[data-mg-item="${review.draft.itemAnchor}"]`
                        : review.draft.cellStart !== undefined
                          ? `[data-mg-cell="${review.draft.cellStart}"]`
                          : undefined,
                  }
                : null
            }
            onPick={review.inspect}
            onRemove={(id) => void review.remove(id)}
            onResolve={(id) => void review.resolve(id)}
          />
        )}

        {!editing && review.selection && !review.draft && (
          // 選択したときの操作。mousedown で処理する。click を待つと、押した時点で
          // ブラウザが選択を解除し selectionchange でこのメニュー自身が消えるため
          // mouseup がどこにも届かない。preventDefault で選択の解除も止める。
          <div
            style={{
              top: review.selection.rect.bottom + 6,
              left: review.selection.rect.left,
            }}
            className="mg-sel-menu"
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                review.startDraft();
              }}
            >
              <Icon name="add_comment" size={14} />
              指摘する
            </button>
            {review.selection.cellStart !== undefined && (
              <>
                <span className="mg-sel-menu-sep" />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commentOnCell();
                  }}
                >
                  <Icon name="table" size={14} />
                  セルに指摘
                </button>
              </>
            )}
            {/* またいだ選択では出さない。先頭のブロックだけに効くと、
                選んだ範囲と食い違う。 */}
            {review.selection.endBlockIndex === undefined && (
              <>
                <span className="mg-sel-menu-sep" />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    startEdit();
                  }}
                >
                  <Icon name="edit" size={14} />
                  編集する
                </button>
                <span className="mg-sel-menu-sep" />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    deleteSelection();
                  }}
                >
                  <Icon name="backspace" size={14} />
                  削除
                </button>
              </>
            )}
          </div>
        )}

        {!editing && review.draft && (
          <CommentComposer
            anchorRect={review.draft.hit}
            selection={review.draft.text}
            // ブロック全体への指摘は、画面から拾った文字を並べても何への指摘か
            // 読み取れない（表は行の間の改行だけが並ぶ）。もとの書き方を渡す。
            source={review.draft.whole ? review.draft.quote : undefined}
            busy={review.busy}
            track={trackDraft}
            bounds={draftArea}
            onSubmit={(text) => void review.submit(text)}
            onClose={review.close}
          />
        )}

        {!editing && path && (
          <DocSearchOverlay
            content={content}
            isActive={isActive}
            path={path}
            docKey={path + (raw?.length ?? 0)}
          />
        )}
      </div>
    </section>
  );
}

// 読込中のプレースホルダ。見出し＋段落の骨組みを並べ、本文が出たときに
// 位置が大きく動かないようにする。
function LoadingBody() {
  const widths = ["45%", "100%", "92%", "78%", "100%", "88%", "60%"];
  return (
    <div className="mg-skeleton" aria-label="読み込み中" aria-busy>
      {widths.map((w, i) => (
        <div
          key={i}
          className={`mg-skeleton-bar${i === 0 ? " mg-skeleton-head" : ""}`}
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

function EmptyPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[var(--mg-muted)]">
      <Icon name="draft" size={56} className="opacity-30" />
      <div className="text-sm">
        左のファイルを選ぶか、
        <kbd className="mx-1 rounded border border-[var(--mg-border)] px-1.5 py-0.5 text-[11px]">
          ⌘P
        </kbd>
        でクイックオープン
      </div>
    </div>
  );
}
