import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  contentCacheAtom,
  docFindOpenAtom,
  highlightAtom,
  searchActiveHitAtom,
  searchFocusNonceAtom,
  searchQueryAtom,
} from "../state/atoms";
import { searchContents, type SearchOptions } from "../lib/search";
import { useWorkspace } from "../hooks/useWorkspace";
import { Icon } from "./Icon";

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function HitPreview({ text, col, len }: { text: string; col: number; len: number }) {
  const before = text.slice(Math.max(0, col - 30), col);
  const match = text.slice(col, col + len);
  const after = text.slice(col + len, col + len + 80);
  return (
    <span className="truncate">
      {col > 30 ? "…" : ""}
      {before}
      <mark className="rounded bg-[var(--mg-mark)] px-0.5 text-[var(--mg-mark-fg)]">{match}</mark>
      {after}
    </span>
  );
}

export function SearchPanel() {
  const cache = useAtomValue(contentCacheAtom);
  const setHighlight = useSetAtom(highlightAtom);
  const setActiveHit = useSetAtom(searchActiveHitAtom);
  const setDocFindOpen = useSetAtom(docFindOpenAtom);
  const focusNonce = useAtomValue(searchFocusNonceAtom);
  const { openFile } = useWorkspace();
  const [query, setQuery] = useAtom(searchQueryAtom);
  const [opts, setOpts] = useState<SearchOptions>({
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
  });
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘F 等でフォーカス要求が来たら入力欄へフォーカス＋全選択
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusNonce]);

  // 検索語（と大小/正規表現オプション）に本文ハイライトを同期する。
  // 空なら解除。ナビゲーションとは独立に、開いている文書へ常に反映する。
  useEffect(() => {
    if (!deferred) {
      setHighlight(null);
      return;
    }
    // ディレクトリ検索が動いている間は ⌘F のファイル内 find ウィジェットを閉じる
    setDocFindOpen(false);
    setHighlight({
      term: deferred,
      caseSensitive: opts.caseSensitive,
      useRegex: opts.useRegex,
      nonce: Math.random(),
    });
  }, [deferred, opts.caseSensitive, opts.useRegex, setHighlight, setDocFindOpen]);

  const { results, total, error } = useMemo(
    () => searchContents(cache, deferred, opts),
    [cache, deferred, opts],
  );

  // 巨大ワークスペースでも描画を軽く保つため、表示するファイル数に上限を設ける
  // （総数は別途カウント表示。ナビゲーションも描画済みの範囲に限る）
  const MAX_FILES = 60;
  const shown = useMemo(() => results.slice(0, MAX_FILES), [results]);
  const truncated = results.length > MAX_FILES;

  // 表示中ファイルのヒットを 1 列に平坦化（↑/↓ で順に辿るため）
  const flat = useMemo(() => {
    const arr: { path: string; hitIndex: number }[] = [];
    shown.forEach((r) =>
      r.hits.forEach((_, hi) => arr.push({ path: r.path, hitIndex: hi })),
    );
    return arr;
  }, [shown]);
  // 各ファイル先頭ヒットのグローバル通し番号
  const baseOffsets = useMemo(() => {
    const offs: number[] = [];
    let acc = 0;
    shown.forEach((r) => {
      offs.push(acc);
      acc += r.hits.length;
    });
    return offs;
  }, [shown]);

  // アクティブな結果（グローバル通し番号）。新しい検索結果ごとにリセット。
  const [sel, setSel] = useState(-1);
  useEffect(() => {
    setSel(-1);
  }, [deferred, opts]);

  const openResult = useCallback(
    (gi: number) => {
      const item = flat[gi];
      if (!item) return;
      setSel(gi);
      openFile(item.path);
      // 本文側へ「このファイルの N 番目のヒットへ」を伝える（ハイライトは別途同期済み）
      setActiveHit({
        path: item.path,
        hitIndex: item.hitIndex,
        nonce: Math.random(),
      });
      // 以降も矢印ナビが効くよう入力欄へフォーカスを戻す
      inputRef.current?.focus();
    },
    [flat, openFile, setActiveHit],
  );

  // アクティブ行をリスト内に見えるようスクロール
  useEffect(() => {
    if (sel < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-gi="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onInputKey = (e: React.KeyboardEvent) => {
    const n = flat.length;
    if (!n) return;
    // 移動は矢印キーのみ（Enter は直感に反するため割り当てない）
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openResult(sel < 0 ? 0 : Math.min(sel + 1, n - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openResult(sel < 0 ? 0 : Math.max(sel - 1, 0));
    }
  };

  // 入力に対して検索（deferred）が追いついていない＝計算中。
  // 速い検索でインジケータをちらつかせないよう、遅延後にだけ「検索中」を出す。
  const pending = query.trim() !== deferred.trim();
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShowLoading(false);
      return;
    }
    const t = window.setTimeout(() => setShowLoading(true), 180);
    return () => window.clearTimeout(t);
  }, [pending]);

  const toggle = (k: keyof SearchOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  return (
    // 矢印ナビはパネル全体で受ける（入力欄・結果ボタンのどこにフォーカスが
    // あってもバブリングで拾い、クリック後も矢印移動を継続できる）
    <div className="flex h-full flex-col" onKeyDown={onInputKey}>
      <div className="border-b border-[var(--mg-border)] p-2">
        <div
          className={`flex items-center gap-1.5 rounded-lg border bg-[var(--mg-input-bg)] px-2 transition focus-within:border-[var(--mg-accent)] ${
            error ? "border-[var(--mg-danger)]" : "border-[var(--mg-border)]"
          }`}
        >
          <Icon name="search" size={17} className="shrink-0 text-[var(--mg-muted)]" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="全文検索…（↑↓ で結果を移動）"
            className="w-full bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[var(--mg-muted)]"
          />
          {query && (
            <button
              title="クリア"
              onClick={() => setQuery("")}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex gap-1">
          {(
            [
              ["caseSensitive", "Aa", "大文字小文字を区別"],
              ["wholeWord", "W", "単語単位"],
              ["useRegex", ".*", "正規表現"],
            ] as const
          ).map(([k, label, title]) => (
            <button
              key={k}
              title={title}
              onClick={() => toggle(k)}
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] transition ${
                opts[k]
                  ? "bg-[var(--mg-accent)] text-white"
                  : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)]"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-[11px] text-[var(--mg-muted)]">
            {error
              ? "正規表現エラー"
              : showLoading
                ? "検索中…"
                : deferred
                  ? `${total} 件 / ${results.length} ファイル`
                  : ""}
          </span>
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((fh, fi) => (
          <div key={fh.path} className="mb-1">
            <div className="sticky top-0 flex items-center gap-1.5 bg-[var(--mg-panel)] px-2 py-1 text-[12px] font-medium text-[var(--mg-fg-dim)]">
              <span className="truncate">{basename(fh.path)}</span>
              <span className="truncate text-[11px] text-[var(--mg-muted)]">{fh.path}</span>
              <span className="ml-auto shrink-0 rounded-full bg-[var(--mg-hover)] px-1.5 text-[10px] text-[var(--mg-muted)]">
                {fh.hits.length}
              </span>
            </div>
            {fh.hits.map((hit, i) => {
              const gi = baseOffsets[fi] + i;
              const activeRow = gi === sel;
              return (
                <button
                  key={i}
                  data-gi={gi}
                  // クリックで入力欄からフォーカスを奪わない（矢印ナビを継続させる）
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openResult(gi)}
                  className={`flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-[12px] transition ${
                    activeRow
                      ? "text-[var(--mg-fg)]"
                      : "text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
                  }`}
                  style={
                    activeRow
                      ? {
                          background:
                            "color-mix(in srgb, var(--mg-accent) 16%, transparent)",
                        }
                      : undefined
                  }
                >
                  <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--mg-muted)]">
                    {hit.line}
                  </span>
                  <HitPreview text={hit.preview} col={hit.column} len={hit.length} />
                </button>
              );
            })}
          </div>
        ))}
        {truncated && (
          <div className="px-3 py-2 text-center text-[11px] text-[var(--mg-muted)]">
            先頭 {MAX_FILES} ファイルを表示中（他 {results.length - MAX_FILES}{" "}
            ファイル）。絞り込んでください
          </div>
        )}
        {/* 計算中は「ヒットなし」を出さない（誤解を避ける）。遅い時だけ検索中を表示 */}
        {query && !error && results.length === 0 && showLoading && (
          <div className="px-3 py-6 text-center text-xs text-[var(--mg-muted)]">
            検索中…
          </div>
        )}
        {query && !error && !pending && results.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-[var(--mg-muted)]">
            ヒットなし
          </div>
        )}
      </div>
    </div>
  );
}
