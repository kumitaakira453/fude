import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { splitBlocks } from "../../lib/blocks";
import { diffBlocks, resolveInDiff, targetIndex, type BlockChange } from "../../lib/blockDiff";
import { fontStack } from "../../lib/fonts";
import { parseFrontmatter } from "../../lib/frontmatter";
import {
  isOpen,
  readVersion,
  replyToThread,
  resolveThread,
  REVIEW_AUTHOR,
  type ReviewThread,
} from "../../lib/review";
import {
  activeFolderIdAtom,
  contentCacheAtom,
  editorialAtom,
  fontAtom,
} from "../../state/atoms";
import {
  ledgerAtom,
  refreshLedger,
  reviewScreenAtom,
  reviewThreadAtom,
} from "../../state/review";
import { Icon } from "../Icon";
import { markdownContext } from "../MarkdownContext";
import { DiffView } from "./DiffView";

// レビュー専用の画面。読書ビューに小窓を重ねる形では、スクロールで位置が崩れ、
// 指摘がどのブロックのことかも並べて見せられない。
// 指摘を主軸に置き、指摘した時点の版と現在の版の差分を文脈ごと出す。

export function ReviewScreen() {
  const ledger = useAtomValue(ledgerAtom);
  const [selectedId, setSelectedId] = useAtom(reviewThreadAtom);
  const setScreen = useSetAtom(reviewScreenAtom);

  const threads = useMemo(() => ledger.threads.filter(isOpen), [ledger]);
  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? threads[0] ?? null,
    [threads, selectedId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      // 入力中の Esc は入力欄側に任せる
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      setScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setScreen]);

  const groups = useMemo(() => {
    const byFile = new Map<string, ReviewThread[]>();
    for (const t of threads) {
      const list = byFile.get(t.file) ?? [];
      list.push(t);
      byFile.set(t.file, list);
    }
    return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [threads]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--mg-bg)] text-[var(--mg-fg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--mg-border)] px-4">
        <Icon name="rate_review" size={18} className="text-[var(--mg-accent)]" />
        <span className="text-[13px] font-medium">レビュー</span>
        <span className="text-[12px] text-[var(--mg-muted)]">
          未解決 {threads.length} 件
        </span>
        <span className="flex-1" />
        <button
          onClick={() => setScreen(false)}
          className="flex items-center gap-1 rounded-lg border border-[var(--mg-border)] px-2.5 py-1 text-[12px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="close" size={15} />
          閉じる
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-80 shrink-0 overflow-y-auto border-r border-[var(--mg-border)] bg-[var(--mg-panel)] px-1.5 py-2">
          {groups.length === 0 && (
            <p className="px-2 py-4 text-[12px] text-[var(--mg-muted)]">
              未解決の指摘はありません。
            </p>
          )}
          {groups.map(([file, list]) => (
            <section key={file} className="mb-3">
              <h2 className="truncate px-2 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
                {file.split("/").pop()}
              </h2>
              {list.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setSelectedId(thread.id)}
                  className={`mb-0.5 w-full rounded-lg px-2 py-1.5 text-left transition ${
                    thread.id === selected?.id
                      ? "bg-[var(--mg-accent-soft)]"
                      : "hover:bg-[var(--mg-hover)]"
                  }`}
                >
                  <div className="truncate text-[10.5px] text-[var(--mg-muted)]">
                    {thread.section_path.length > 0
                      ? thread.section_path.join(" › ")
                      : "ファイル先頭"}
                  </div>
                  <div className="line-clamp-2 text-[12.5px] leading-snug">
                    {thread.comments[0]?.body ?? thread.selection}
                  </div>
                </button>
              ))}
            </section>
          ))}
        </nav>

        {selected ? (
          <ThreadDetail key={selected.id} thread={selected} />
        ) : (
          <p className="p-8 text-[13px] text-[var(--mg-muted)]">
            指摘を選ぶと、指摘した時点の本文と現在の本文を並べて表示します。
          </p>
        )}
      </div>
    </div>
  );
}

function ThreadDetail({ thread }: { thread: ReviewThread }) {
  const store = useStore();
  const cache = useAtomValue(contentCacheAtom);
  const root = useAtomValue(activeFolderIdAtom);
  const editorial = useAtomValue(editorialAtom);
  const font = useAtomValue(fontAtom);
  const setScreen = useSetAtom(reviewScreenAtom);
  const { openFile, resolveAsset, peekAsset } = useWorkspace();
  const [baseText, setBaseText] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const rel = useMemo(() => {
    if (!root) return null;
    const prefix = `${root}/`;
    return thread.file.startsWith(prefix) ? thread.file.slice(prefix.length) : null;
  }, [root, thread.file]);

  const currentBody = useMemo(() => {
    const raw = rel ? cache.get(rel) : undefined;
    return raw === undefined ? null : parseFrontmatter(raw).body;
  }, [cache, rel]);

  useEffect(() => {
    let alive = true;
    setBaseText(null);
    void readVersion(thread.base_version).then((text) => {
      if (alive) setBaseText(text);
    });
    return () => {
      alive = false;
    };
  }, [thread.base_version]);

  // 基準版に指摘の対象が見つかるときだけ差分を出す。見つからない基準版と
  // 比べても、指摘とは関係ない版どうしの差分が大量に並ぶだけで読み手を惑わせる。
  // 取り込んだ指摘では、対象の文が基準版にも現在の本文にも残っていないことが多い。
  const view = useMemo(() => {
    if (currentBody === null) return null;
    const head = splitBlocks(currentBody);

    if (baseText !== null) {
      const diff = diffBlocks(splitBlocks(parseFrontmatter(baseText).body), head);
      const resolution = resolveInDiff(diff, thread.quote, thread.selection);
      if (resolution.state !== "unknown") {
        const changed = diff.filter((c) => c.kind !== "same").length;
        const where = changed === 0 ? "" : `この文書で変わった箇所は ${changed} 件。`;
        const note =
          resolution.state === "rewritten"
            ? `${where}指摘した箇所は書き換わっています。印の位置に指摘した時点と現在を並べています。`
            : resolution.state === "removed"
              ? `${where}指摘した箇所は削除されています。`
              : `${where}指摘した箇所は書き換わっていません。`;
        return { diff, target: resolution.index, note };
      }
    }

    const plain: BlockChange[] = head.map((b) => ({ kind: "same", base: b, head: b }));
    const target = targetIndex(plain, thread.quote, thread.selection);
    return {
      diff: plain,
      target,
      note:
        target >= 0
          ? "指摘した時点の版が残っていないため、現在の本文を表示しています。対象の箇所に印を付けています。"
          : "指摘した時点の版が残っておらず、対象の文も現在の本文には見当たりません。現在の本文を表示しています。",
    };
  }, [baseText, currentBody, thread.quote, thread.selection]);

  const ctx = useMemo(
    () => ({
      onNavigate: () => {},
      resolveAsset: (src: string) => resolveAsset(rel ?? "", src),
      peekAsset: (src: string) => peekAsset(rel ?? "", src),
      docPath: rel ?? "",
    }),
    [rel, resolveAsset, peekAsset],
  );

  const send = useCallback(async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (await replyToThread(thread.id, REVIEW_AUTHOR, text)) {
        setReply("");
        await refreshLedger(store);
      }
    } finally {
      setBusy(false);
    }
  }, [reply, busy, thread.id, store]);

  const finish = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await resolveThread(thread.id, REVIEW_AUTHOR)) await refreshLedger(store);
    } finally {
      setBusy(false);
    }
  }, [busy, thread.id, store]);

  const style = { fontFamily: fontStack(font) };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--mg-muted)]">
              {thread.file.split("/").pop()}
              {thread.section_path.length > 0 &&
                ` › ${thread.section_path.join(" › ")}`}
            </span>
            {rel && (
              <button
                onClick={() => {
                  openFile(rel);
                  setScreen(false);
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--mg-border)] px-2.5 py-1 text-[12px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
              >
                <Icon name="open_in_new" size={14} />
                本文を開く
              </button>
            )}
          </div>

          <section className="mb-5 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] px-4 py-3">
            {thread.comments.map((c) => (
              <div key={c.id} className="mb-2.5 last:mb-0">
                <div className="text-[10.5px] font-medium text-[var(--mg-muted)]">
                  {c.author}
                </div>
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
                  {c.body}
                </div>
              </div>
            ))}
          </section>

          {currentBody === null ? (
            <p className="text-[12px] text-[var(--mg-muted)]">
              このファイルは今開いているフォルダの中にないため、現在の本文と比べられません。
            </p>
          ) : view === null ? (
            <p className="text-[12px] text-[var(--mg-muted)]">差分を読み込んでいます…</p>
          ) : (
            <markdownContext.Provider value={ctx}>
              <DiffView
                diff={view.diff}
                targetIndex={view.target}
                note={view.note}
                editorial={editorial}
                style={style}
              />
            </markdownContext.Provider>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--mg-border)] bg-[var(--mg-panel)] px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="返信…（⌘Enter で送信）"
            className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--mg-border)] bg-[var(--mg-input-bg)] px-3 py-2 text-[13px] outline-none transition placeholder:text-[var(--mg-muted)] focus:border-[var(--mg-accent)]"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !reply.trim()}
            className="rounded-lg border border-[var(--mg-border)] px-3 py-2 text-[12px] font-medium text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)] disabled:opacity-40"
          >
            返信
          </button>
          <button
            onClick={() => void finish()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--mg-accent)] px-3.5 py-2 text-[12px] font-semibold text-[var(--mg-bg)] shadow-sm transition hover:brightness-110 disabled:opacity-40"
          >
            <Icon name="check_circle" size={16} fill />
            解決にする
          </button>
        </div>
      </div>
    </div>
  );
}
