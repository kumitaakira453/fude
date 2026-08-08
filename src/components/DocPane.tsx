import { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  activePaneIdAtom,
  contentCacheAtom,
  fontAtom,
  readingWidthAtom,
  tocOpenAtom,
  watchModeAtom,
  type Pane,
} from "../state/atoms";
import { parseFrontmatter, extractMeta } from "../lib/frontmatter";
import { fontStack } from "../lib/fonts";
import { closePane } from "../lib/ui";
import { markdownContext } from "./MarkdownContext";
import { Markdown } from "./Markdown";
import { Toc } from "./Toc";
import { useWorkspace } from "../hooks/useWorkspace";
import { useSearchHighlight } from "../hooks/useSearchHighlight";
import { Icon } from "./Icon";

const WIDTH_CLASS: Record<string, string> = {
  cozy: "max-w-[760px]",
  wide: "max-w-[1000px]",
  full: "max-w-none",
};

export function DocPane({ pane, isSplit }: { pane: Pane; isSplit: boolean }) {
  const cache = useAtomValue(contentCacheAtom);
  const font = useAtomValue(fontAtom);
  const width = useAtomValue(readingWidthAtom);
  const tocOpen = useAtomValue(tocOpenAtom);
  const watchMode = useAtomValue(watchModeAtom);
  const [activeId, setActiveId] = useAtom(activePaneIdAtom);
  const store = useStore();
  const { navigate, resolveAsset, peekAsset, reloadFile } = useWorkspace();

  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);

  const isActive = activeId === pane.id;
  const path = pane.path;
  const raw = path ? cache.get(path) : undefined;

  const { data, body } = useMemo(() => parseFrontmatter(raw ?? ""), [raw]);
  const meta = useMemo(() => extractMeta(data), [data]);

  // path はあるが未読込なら読み込む
  useEffect(() => {
    if (path && !cache.has(path)) void reloadFile(path);
  }, [path, cache, reloadFile]);

  // 読書プログレス
  useEffect(() => {
    if (!scroller) return;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      setProgress(max > 0 ? Math.min(1, scroller.scrollTop / max) : 0);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scroller, raw]);

  // 別ファイルに切り替わったら先頭へ
  useEffect(() => {
    scroller?.scrollTo({ top: 0 });
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
        isSplit && isActive ? "ring-1 ring-inset ring-[var(--mg-accent)]/40" : ""
      }`}
    >
      {/* ヘッダー */}
      <header className="flex items-center gap-2 border-b border-[var(--mg-border)] bg-[var(--mg-panel)]/80 px-4 py-2 backdrop-blur">
        <div className="min-w-0 flex-1 truncate text-[12px] text-[var(--mg-muted)]">
          {path ? path.split("/").join("  ›  ") : "ファイル未選択"}
        </div>
        <span
          title={
            watchMode === "observer"
              ? "リアルタイム監視中 (FileSystemObserver)"
              : watchMode === "polling"
                ? "監視中 (ポーリング)"
                : "監視停止"
          }
          className={`h-2 w-2 shrink-0 rounded-full ${
            watchMode === "observer"
              ? "bg-emerald-400"
              : watchMode === "polling"
                ? "bg-amber-400"
                : "bg-zinc-500"
          }`}
        />
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
        <div ref={setScroller} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {path ? (
            <div className="px-6 py-8 sm:px-10">
              <article
                ref={setContent}
                style={{ fontFamily: fontStack(font) }}
                className={`mg-prose prose ${WIDTH_CLASS[width]} mx-auto`}
              >
                {(meta.title || meta.tags.length > 0) && (
                  <div className="mb-6 border-b border-[var(--mg-border)] pb-4">
                    {meta.title && (
                      <h1 className="!mb-2 !mt-0">{meta.title}</h1>
                    )}
                    {meta.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {meta.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-[var(--mg-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--mg-accent)]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <markdownContext.Provider value={ctx}>
                  <Markdown body={body} />
                </markdownContext.Provider>
              </article>
            </div>
          ) : (
            <EmptyPane />
          )}
        </div>

        {!isSplit && tocOpen && path && (
          <Toc content={content} scroller={scroller} contentKey={path + (raw?.length ?? 0)} />
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
