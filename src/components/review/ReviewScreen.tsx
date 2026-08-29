import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { sectionPathAt, splitBlocks, type Block } from "../../lib/blocks";
import {
  diffBlocks,
  headIndexAt,
  probeOf,
  rankByCoverage,
  resolveInDiff,
  targetIndex,
  type BlockChange,
} from "../../lib/blockDiff";
import { fontStack } from "../../lib/fonts";
import { parseFrontmatter } from "../../lib/frontmatter";
import {
  isOpen,
  readVersion,
  replyToThread,
  resolveThread,
  REVIEW_AUTHOR,
  type ReviewComment,
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
import { DocumentView, type Anchor } from "./DocumentView";

// レビュー専用の画面。読書ビューに小窓を重ねる形では、スクロールで位置が崩れ、
// 指摘がどのブロックのことかも並べて見せられない。
// 本文は本文として読ませ、やり取りは横に置く。

// フォルダからの相対パス。台帳は絶対パスで持っている。
function relativeTo(root: string | null, file: string): string | null {
  if (!root) return null;
  const prefix = `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
}

// 一覧と見出しに出すファイルの道筋。開いているフォルダの中なら
// そこからの相対パス、外なら絶対パスをそのまま出す。
// 同じ名前のファイルが別の節に何枚もあるので、名前だけでは見分けられない。
function pathLabel(root: string | null, file: string): string {
  return relativeTo(root, file) ?? file;
}

function plainDiff(blocks: Block[]): BlockChange[] {
  return blocks.map((b) => ({ kind: "same", base: b, head: b }));
}

// 見出しを辿った道筋。取り込んだ指摘は節の情報を持たないので、本文から組み立てる。
function whereOf(thread: ReviewThread, blocks: Block[] | undefined): string {
  if (blocks) {
    const index = targetIndex(plainDiff(blocks), thread.quote, thread.selection);
    if (index >= 0) {
      const path = sectionPathAt(blocks, index);
      if (path.length > 0) return path.join(" › ");
    }
  }
  if (thread.section_path.length > 0) return thread.section_path.join(" › ");
  return "見出しの外";
}

export function ReviewScreen() {
  const ledger = useAtomValue(ledgerAtom);
  const cache = useAtomValue(contentCacheAtom);
  const root = useAtomValue(activeFolderIdAtom);
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

  // ファイルごとに 1 回だけブロックへ割る。一覧の全件で見出しを辿るため。
  const blocksByFile = useMemo(() => {
    const map = new Map<string, Block[]>();
    for (const t of threads) {
      if (map.has(t.file)) continue;
      const rel = relativeTo(root, t.file);
      const raw = rel === null ? undefined : cache.get(rel);
      if (raw === undefined) continue;
      map.set(t.file, splitBlocks(parseFrontmatter(raw).body));
    }
    return map;
  }, [threads, cache, root]);

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
    <div className="mg-review flex h-screen w-screen flex-col overflow-hidden bg-[var(--mg-bg)] text-[var(--mg-fg)]">
      <header className="mg-review-head flex h-14 shrink-0 items-center gap-3 px-5">
        <Icon name="rate_review" size={20} className="text-[var(--mg-accent)]" />
        <div className="min-w-0">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[var(--mg-muted)]">
            Review
          </div>
          <div className="text-[13px] font-medium leading-tight">
            {threads.length > 0
              ? `未解決 ${threads.length} 件`
              : "未解決の指摘はありません"}
          </div>
        </div>
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
        <nav className="w-[19rem] shrink-0 overflow-y-auto border-r border-[var(--mg-border)] bg-[var(--mg-panel)] px-2 py-2">
          {groups.length === 0 && (
            <p className="px-2 py-4 text-[12px] text-[var(--mg-muted)]">
              指摘が付くとここに並びます。
            </p>
          )}
          {groups.map(([file, list]) => (
            <section key={file} className="mb-4">
              <h2 className="mg-review-group">
                <span className="mg-review-path">{pathLabel(root, file)}</span>
                <span className="mg-count">{list.length}</span>
              </h2>
              {list.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  where={whereOf(thread, blocksByFile.get(thread.file))}
                  active={thread.id === selected?.id}
                  onPick={() => setSelectedId(thread.id)}
                />
              ))}
            </section>
          ))}
        </nav>

        {selected ? (
          <ThreadDetail key={selected.id} thread={selected} />
        ) : (
          <p className="p-8 text-[13px] text-[var(--mg-muted)]">
            指摘を選ぶと、その箇所が今どうなっているかを本文の中で示します。
          </p>
        )}
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  where,
  active,
  onPick,
}: {
  thread: ReviewThread;
  where: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button onClick={onPick} className={`mg-thread-card ${active ? "is-active" : ""}`}>
      <div className="mg-thread-where">{where}</div>
      <div className="mg-thread-quote">{thread.selection || thread.quote}</div>
      <div className="mg-thread-body">
        {thread.comments[0]?.body ?? "（本文なし）"}
      </div>
      {thread.comments.length > 1 && (
        <div className="mg-thread-more">
          <Icon name="forum" size={12} />
          {thread.comments.length}
        </div>
      )}
    </button>
  );
}

// 指摘の箇所が今どこにあるか。基準版があればそこから対応付け、
// 無ければ現在の本文から探す。どちらも駄目なら候補だけ示す。
function locate(thread: ReviewThread, head: Block[], baseText: string | null): Anchor {
  if (baseText !== null) {
    const diff = diffBlocks(splitBlocks(parseFrontmatter(baseText).body), head);
    const r = resolveInDiff(diff, thread.quote, thread.selection);
    const index = Math.min(headIndexAt(diff, r.index), head.length);
    if (r.state === "unchanged") return { state: "unchanged", index };
    if (r.state === "rewritten") return { state: "rewritten", index, before: r.base.src };
    if (r.state === "removed") return { state: "removed", index, before: r.base.src };
  }

  const plain = plainDiff(head);
  const index = targetIndex(plain, thread.quote, thread.selection);
  if (index >= 0) return { state: "unchanged", index };

  // 特定できないときは、引用をいくらか含んでいるブロックを近い順に示す。
  // 「分かりません」で終えると、読み手は文書全体を目で探すことになる。
  const candidates = rankByCoverage(plain, probeOf(thread.quote, thread.selection))
    .filter((c) => c.score >= 0.3)
    .slice(0, 3)
    .map((c) => c.index);
  return { state: "unknown", candidates };
}

const STATE_NOTE: Record<Anchor["state"], string> = {
  unchanged: "指摘の箇所はまだ書き換わっていません。",
  rewritten: "指摘の箇所は書き換わっています。指摘した時点の文を上に並べています。",
  removed: "指摘の箇所は今の本文から削除されています。",
  unknown: "指摘の文は今の本文に見当たりません。近そうな箇所に印を付けています。",
};

const when = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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

  const rel = useMemo(() => relativeTo(root, thread.file), [root, thread.file]);

  const currentBody = useMemo(() => {
    const raw = rel === null ? undefined : cache.get(rel);
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

  const view = useMemo(() => {
    if (currentBody === null) return null;
    const blocks = splitBlocks(currentBody);
    const anchor = locate(thread, blocks, baseText);
    const crumbs =
      anchor.state === "unknown"
        ? thread.section_path
        : sectionPathAt(blocks, Math.min(anchor.index, blocks.length - 1));
    return { blocks, anchor, crumbs };
  }, [baseText, currentBody, thread]);

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
  // 会話を左右に振る。指摘を出した人（＝最初に発言した人）を右に置く。
  const reviewer =
    thread.comments.find((c) => !AGENT_AUTHORS.has(c.author))?.author ?? REVIEW_AUTHOR;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {currentBody === null ? (
            <p className="text-[12px] text-[var(--mg-muted)]">
              このファイルは今開いているフォルダの中にないため、現在の本文を出せません。
            </p>
          ) : view === null ? (
            <p className="text-[12px] text-[var(--mg-muted)]">読み込んでいます…</p>
          ) : (
            <markdownContext.Provider value={ctx}>
              <DocumentView
                blocks={view.blocks}
                anchor={view.anchor}
                editorial={editorial}
                style={style}
              />
            </markdownContext.Provider>
          )}
        </div>
      </div>

      <aside className="mg-side">
        <div className="mg-side-head">
          <span className="mg-review-path flex-1" title={thread.file}>
            {pathLabel(root, thread.file)}
          </span>
          {rel && (
            <button
              onClick={() => {
                openFile(rel);
                setScreen(false);
              }}
              className="mg-side-open"
            >
              <Icon name="open_in_new" size={13} />
              本文を開く
            </button>
          )}
        </div>

        <nav className="mg-crumbs">
          {(view?.crumbs.length ? view.crumbs : ["見出しの外"]).map((name, i) => (
            <span key={`${i}-${name}`}>
              {i > 0 && <span className="sep">›&nbsp;</span>}
              {name}
            </span>
          ))}
        </nav>

        <blockquote className="mg-side-quote" style={style}>
          {thread.selection || thread.quote}
        </blockquote>

        <div className="mg-talk">
          {thread.comments.map((c, i) => (
            <Message
              key={c.id}
              comment={c}
              mine={c.author === reviewer}
              run={thread.comments[i - 1]?.author === c.author}
            />
          ))}
        </div>

        {view && (
          <p className={`mg-side-state is-${view.anchor.state}`}>
            <Icon
              name={view.anchor.state === "unknown" ? "help" : "my_location"}
              size={13}
              className="mt-px shrink-0"
            />
            {STATE_NOTE[view.anchor.state]}
          </p>
        )}

        <div className="mg-side-compose">
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
            className="w-full resize-none rounded-lg border border-[var(--mg-border)] bg-[var(--mg-input-bg)] px-3 py-2 text-[12.5px] outline-none transition placeholder:text-[var(--mg-muted)] focus:border-[var(--mg-accent)]"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void send()}
              disabled={busy || !reply.trim()}
              className="rounded-lg border border-[var(--mg-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)] disabled:opacity-40"
            >
              返信
            </button>
            <span className="flex-1" />
            <button onClick={() => void finish()} disabled={busy} className="mg-resolve">
              <Icon name="check_circle" size={15} fill />
              解決にする
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

// 答える側の顔。エージェントには機械らしい印を出し、人には人の印を出す。
const AGENT_AUTHORS = new Set(["AI", "ai", "assistant", "claude"]);

function Message({
  comment,
  mine,
  run,
}: {
  comment: ReviewComment;
  mine: boolean;
  run: boolean;
}) {
  const agent = AGENT_AUTHORS.has(comment.author);
  return (
    <div className={`mg-msg ${mine ? "is-reviewer" : ""} ${run ? "is-run" : ""}`}>
      {!mine && (
        <span className="mg-msg-face">
          <Icon name={agent ? "auto_awesome" : "person"} size={14} fill />
        </span>
      )}
      <div className="mg-msg-main">
        {!run && (
          <div className="mg-msg-meta">
            {/* 使っている本人の発言は、台帳に残る名前が何であれ「you」と呼ぶ */}
            <span className="mg-msg-name">{mine ? "you" : comment.author}</span>
            <span>{when.format(comment.created_at)}</span>
          </div>
        )}
        <div className="mg-bubble">{comment.body}</div>
      </div>
    </div>
  );
}
