import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchHighlight } from "../hooks/useSearchHighlight";
import { useWorkspace } from "../hooks/useWorkspace";
import { fontStack } from "../lib/fonts";
import { parseFrontmatter } from "../lib/frontmatter";
import { closePane } from "../lib/ui";
import {
  activePaneIdAtom,
  contentCacheAtom,
  editorialAtom,
  fontAtom,
  readingWidthAtom,
  tocOpenAtom,
  watchModeAtom,
  type Pane,
} from "../state/atoms";
import { Frontmatter } from "./Frontmatter";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { markdownContext } from "./MarkdownContext";
import { MarkdownEditor } from "./MarkdownEditor";
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
  const { navigate, resolveAsset, peekAsset, reloadFile, saveFile } =
    useWorkspace();

  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);
  // スクロール割合(0〜1)をプレビューと編集で共有し、切替で位置を引き継ぐ。
  // 同一内容なら frac×max は元の top と一致するため、ファイル復帰時の復元にも使える。
  const scrollFracRef = useRef<{ path: string | null; frac: number }>({
    path: null,
    frac: 0,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const isActive = activeId === pane.id;
  const path = pane.path;
  const raw = path ? cache.get(path) : undefined;

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
  }, [path]);

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

  // path はあるが未読込なら読み込む
  useEffect(() => {
    if (path && !cache.has(path)) void reloadFile(path);
  }, [path, cache, reloadFile]);

  // 読書プログレス
  useEffect(() => {
    if (!scroller) return;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const frac = max > 0 ? Math.min(1, scroller.scrollTop / max) : 0;
      setProgress(frac);
      scrollFracRef.current = { path, frac };
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scroller, raw, path]);

  // scroller マウント時: 同じファイルなら保存割合へ、別ファイルなら先頭へ。
  // 画像/KaTeX で高さが後から変わるため rAF でレイアウト確定後に適用。
  useEffect(() => {
    if (!scroller) return;
    const saved = scrollFracRef.current;
    const frac = saved.path === path ? saved.frac : 0;
    requestAnimationFrame(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = max > 0 ? frac * max : 0;
    });
  }, [path, scroller]);

  useSearchHighlight(content, isActive);

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
          {path ? path.split("/").join("  ›  ") : "ファイル未選択"}
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
            title={editing ? "プレビュー (⌘E)" : "編集 (⌘E)"}
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
          className="h-full bg-[var(--mg-accent)] transition-[width] duration-150"
          style={{ width: `${progress * 100}%` }}
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
            {path ? (
              <div
                className="px-6 py-8 sm:px-10"
                onDoubleClick={() => {
                  // ダブルクリックで編集モードへ（リンク/画像上は除く）
                  const sel = window.getSelection?.();
                  if (sel && sel.toString().length > 40) return;
                  enterEdit();
                }}
              >
                <article
                  ref={setContent}
                  style={{ fontFamily: fontStack(font) }}
                  className={`mg-prose prose ${
                    editorial ? "mg-editorial" : ""
                  } ${WIDTH_CLASS[width]} mx-auto`}
                >
                  {data && <Frontmatter data={data} />}
                  <markdownContext.Provider value={ctx}>
                    <Markdown body={body} editorial={editorial} />
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
      </div>
    </section>
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
