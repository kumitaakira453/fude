import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocSearchOverlay } from "./DocSearchOverlay";
import { useReview } from "../hooks/useReview";
import { useWorkspace } from "../hooks/useWorkspace";
import { fontStack } from "../lib/fonts";
import { parseFrontmatter } from "../lib/frontmatter";
import { closePane } from "../lib/ui";
import {
  activePath,
  activePaneIdAtom,
  contentCacheAtom,
  editorialAtom,
  fontAtom,
  readingWidthAtom,
  revealInTreeAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  tocOpenAtom,
  watchModeAtom,
  type Pane,
} from "../state/atoms";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { EditableBody } from "./EditableBody";
import { Frontmatter } from "./Frontmatter";
import { Icon } from "./Icon";
import { markdownContext } from "./MarkdownContext";
import { MarkdownEditor } from "./MarkdownEditor";
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
  // スクロール割合(0〜1)をプレビューと編集で共有し、切替で位置を引き継ぐ。
  // 同一内容なら frac×max は元の top と一致するため、ファイル復帰時の復元にも使える。
  const scrollFracRef = useRef<{ path: string | null; frac: number }>({
    path: null,
    frac: 0,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // フロントマター（先頭の --- ブロック）をその場編集中か（開始時のクリック座標）
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
    setDraft(raw ?? "");
    setEditing(true);
  };
  const save = () => {
    if (path) void saveFile(path, draft);
  };
  const exitEdit = () => {
    if (path && draft !== (raw ?? "")) void saveFile(path, draft);
    setEditing(false);
  };
  const toggleEdit = () => (editing ? exitEdit() : enterEdit());

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
      const ae = document.activeElement as HTMLElement | null;
      // 編集中の入力欄（CodeMirror・セルのインライン textarea 等）では、
      // その入力欄自身のネイティブ undo を優先し、ドキュメント全体の undo は行わない
      if (
        ae?.closest?.(".cm-editor") ||
        ae?.tagName === "TEXTAREA" ||
        ae?.tagName === "INPUT" ||
        ae?.isContentEditable
      )
        return;
      if (!path) return;
      e.preventDefault();
      if (e.shiftKey) void redoFile(path);
      else void undoFile(path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, path, undoFile, redoFile]);

  // ⌘E で編集/プレビュー切替（アクティブペインのみ）
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        toggleEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, editing, draft, raw, path]);

  const { data, body } = useMemo(() => parseFrontmatter(raw ?? ""), [raw]);
  const absPath = useMemo(() => (path ? absOf(path) : null), [path, absOf]);
  const review = useReview({ absPath, body, raw, content, isActive });

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

  // 読書プログレス + スクロール位置の保存。
  // 重要: マウント時に即時実行しない。まだ復元前で scrollTop=0 のため、
  // 保存割合を 0 で上書きしてしまい「切替のたびに先頭へ」戻る原因になる。
  // 保存は実際のスクロール操作時のみ行う。
  useEffect(() => {
    if (!scroller) return;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const frac = max > 0 ? Math.min(1, scroller.scrollTop / max) : 0;
      setBar(frac);
      scrollFracRef.current = { path, frac };
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scroller, raw, path]);

  // scroller マウント時: 同じファイルなら保存割合へ、別ファイルなら先頭へ。
  // 画像/KaTeX で高さが後から変わるため rAF でレイアウト確定後に適用。
  useEffect(() => {
    if (!scroller) return;
    const saved = scrollFracRef.current;
    const frac = saved.path === path ? saved.frac : 0;
    setBar(frac);
    if (frac === 0) {
      scroller.scrollTop = 0;
      return;
    }
    // 本文は先頭から順に描画されるので、高さが伸びている間は復元をやり直す。
    // 画像や KaTeX で後から高さが変わる場合にも効く。
    // ユーザーが自分でスクロールしたら、そこで復元を打ち切る。
    let settled = false;
    const apply = () => {
      if (settled) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max > 0) scroller.scrollTop = frac * max;
    };
    const stop = () => {
      settled = true;
    };
    const raf = requestAnimationFrame(apply);
    const ro = content ? new ResizeObserver(apply) : null;
    ro?.observe(content!);
    scroller.addEventListener("wheel", stop, { passive: true, once: true });
    scroller.addEventListener("touchstart", stop, { passive: true, once: true });
    const timer = window.setTimeout(stop, 2000);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.clearTimeout(timer);
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("touchstart", stop);
    };
  }, [path, scroller, content]);


  const ctx = useMemo(
    () => ({
      docPath: path ?? "",
      onNavigate: (href: string) => path && navigate(path, href),
      resolveAsset: (src: string) => resolveAsset(path ?? "", src),
      peekAsset: (src: string) => peekAsset(path ?? "", src),
    }),
    [path, navigate, resolveAsset, peekAsset],
  );

  const doClosePane = () => closePane(store, pane.id);

  // パンくずのセグメントをクリック → サイドバーを開き、ツリーで対象を展開/強調
  const setSidebarOpen = useSetAtom(sidebarOpenAtom);
  const setSidebarTab = useSetAtom(sidebarTabAtom);
  const setReveal = useSetAtom(revealInTreeAtom);
  const revealInTree = (target: string) => {
    setSidebarOpen(true);
    setSidebarTab("files");
    setReveal({ path: target, nonce: Date.now() });
  };

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
          {path ? (
            path.split("/").map((seg, i, arr) => (
              <span key={i}>
                {i > 0 && <span className="mx-1.5 opacity-60">›</span>}
                <button
                  onClick={() => revealInTree(arr.slice(0, i + 1).join("/"))}
                  title="ツリーで表示"
                  className="rounded hover:text-[var(--mg-accent)] hover:underline"
                >
                  {seg}
                </button>
              </span>
            ))
          ) : (
            <span>ファイル未選択</span>
          )}
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
            initialScrollFraction={
              scrollFracRef.current.path === path
                ? scrollFracRef.current.frac
                : 0
            }
            onScrollFraction={(frac) => {
              scrollFracRef.current = { path, frac };
            }}
          />
        ) : (
          <div
            ref={setScroller}
            className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            {path && !loaded ? (
              <div className="px-6 py-8 sm:px-10">
                {showLoading && (
                  <div className={`${WIDTH_CLASS[width]} mx-auto`}>
                    <LoadingBody />
                  </div>
                )}
              </div>
            ) : path ? (
              <div className="px-6 py-8 sm:px-10">
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
                    {/* ダブルクリックしたブロックだけをその場で生ソース編集 */}
                    {/* key でファイルごとに貼り替え、漸進描画を先頭からやり直す */}
                    <EditableBody
                      key={path}
                      body={body}
                      editorial={editorial}
                      onSaveBody={saveBody}
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
            onPick={review.inspect}
          />
        )}

        {!editing && review.selection && !review.draft && (
          <button
            type="button"
            // mousedown で処理する。click を待つと、押した時点でブラウザが選択を
            // 解除し selectionchange でこのボタン自身が消えるため mouseup が
            // どこにも届かない。preventDefault で選択の解除も止める。
            onMouseDown={(e) => {
              e.preventDefault();
              review.startDraft();
            }}
            style={{
              top: review.selection.rect.bottom + 6,
              left: review.selection.rect.left,
            }}
            className="fixed z-30 flex items-center gap-1 rounded-lg border border-[var(--mg-border)] bg-[var(--mg-panel)] px-2 py-1 text-[12px] font-medium shadow-lg transition hover:border-[var(--mg-accent)] hover:text-[var(--mg-accent)]"
          >
            <Icon name="add_comment" size={14} />
            指摘する
          </button>
        )}

        {!editing && review.draft && (
          <CommentComposer
            anchorRect={review.draft.hit}
            selection={review.draft.text}
            busy={review.busy}
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
