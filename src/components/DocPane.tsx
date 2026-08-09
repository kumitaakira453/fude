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
import { BlockSourceEditor } from "./BlockSourceEditor";
import { EditableBody } from "./EditableBody";
import { Frontmatter } from "./Frontmatter";
import { Icon } from "./Icon";
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
    setEditingFm(null);
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

  // ブロック編集の確定: body を差し戻し、フロントマターを保ったまま全文保存する。
  // body は raw の suffix なので、先頭の frontmatter 部分を prefix として復元する。
  const saveBody = (newBody: string) => {
    if (!path) return;
    const full = raw ?? "";
    const prefix = full.slice(0, full.length - body.length);
    void saveFile(path, prefix + newBody);
  };

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
    const raf = requestAnimationFrame(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = max > 0 ? frac * max : 0;
    });
    return () => cancelAnimationFrame(raf);
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
            {path ? (
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
                    <EditableBody
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
