import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  resolveThreads,
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
import { Quote } from "./Quote";

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
    const diff = plainDiff(blocks);
    let index = targetIndex(diff, thread.quote, thread.selection);
    if (index < 0) {
      // 箇所を確定できなくても、いちばん近い候補の節までは手掛かりになる。
      // 節の名前が分かるだけで、指摘がどの話題のものかは掴める。
      const best = rankByCoverage(diff, probeOf(thread.quote, thread.selection))[0];
      if (best && best.score >= 0.3) index = best.index;
    }
    if (index >= 0) {
      const path = sectionPathAt(blocks, index);
      if (path.length > 0) return path.join(" › ");
    }
  }
  if (thread.section_path.length > 0) return thread.section_path.join(" › ");
  return "見出しの外";
}

// 値を「画面を 1 枚描き切ってから」受け取る。
//
// requestAnimationFrame は次の描画の直前に呼ばれるので、1 回だけだと画面が
// 出る前に重い処理が始まり、待っている表示が誰の目にも触れない。実際に描かれる
// のを待つには 2 回いる。
// React の割り込み可能な更新（startTransition / useDeferredValue）には頼らない。
// 周りで別の更新が起き続けるかぎり後回しにされ、切り替わらないままになり得る。
function useAfterPaint<T>(value: T): T | undefined {
  const [shown, setShown] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (shown === value) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(value));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [value, shown]);
  return shown;
}

export function ReviewScreen() {
  const ledger = useAtomValue(ledgerAtom);
  const cache = useAtomValue(contentCacheAtom);
  const root = useAtomValue(activeFolderIdAtom);
  const [selectedId, setSelectedId] = useAtom(reviewThreadAtom);
  const setScreen = useSetAtom(reviewScreenAtom);
  const store = useStore();
  // 一括解決の最中のファイル。そのファイルの見出しだけを処理中の見た目にする。
  const [bulkFile, setBulkFile] = useState<string | null>(null);
  const bulkRunning = useRef(false);

  const threads = useMemo(() => ledger.threads.filter(isOpen), [ledger]);

  // 選んだ指摘を、画面を 1 枚描き切ってから受け取る。押した手応えと
  // 待っている表示を先に出し、重い本文の組み立てはその後に回す。
  const shownId = useAfterPaint(selectedId);
  const ready = shownId !== undefined;
  const pending = !ready || shownId !== selectedId;

  const pick = useCallback(
    (id: string | null) => threads.find((t) => t.id === id) ?? threads[0] ?? null,
    [threads],
  );
  const selected = useMemo(() => pick(selectedId), [pick, selectedId]);
  const shown = useMemo(
    () => (pending ? null : pick(shownId ?? null)),
    [pending, pick, shownId],
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

  // 1 ファイル分の指摘をまとめて解決にする。解決を取り消す手段が無いので、
  // 消えて困る操作として必ず確認を挟む。
  const resolveFile = useCallback(
    async (file: string, list: ReviewThread[]) => {
      if (bulkRunning.current) return;
      bulkRunning.current = true;
      setBulkFile(file);
      try {
        const name = file.split("/").pop() ?? file;
        const ok = await confirm(
          `${name} の未解決 ${list.length} 件をすべて解決にします。\n取り消せません。`,
          { title: "mdglow", kind: "warning" },
        );
        if (!ok) return;
        const ids = list.map((t) => t.id);
        if ((await resolveThreads(ids, REVIEW_AUTHOR)) !== null) {
          await refreshLedger(store);
        }
      } finally {
        bulkRunning.current = false;
        setBulkFile(null);
      }
    },
    [store],
  );

  // 一覧に出す「どこの話か」。文書をブロックへ割り、指摘ごとに見出しを辿る
  // 重い処理なので、描画の中ではなくファイル 1 枚ずつフレームを分けて進める。
  // まとめてやると数百ミリ秒画面が固まり、選択にも反応できなくなる。
  const [whereById, setWhereById] = useState<Map<string, string>>(new Map());
  // 索引づくりの途中は本文の控えが何度も差し替わる。それに引きずられて
  // 辿り直しをやり直すと、いつまでも終わらないので参照だけ持っておく。
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  useEffect(() => {
    if (!ready) return;
    const files = groups.map(([file]) => file);
    const found = new Map<string, string>();
    let i = 0;
    let frame = 0;
    const step = () => {
      const file = files[i++];
      const rel = relativeTo(root, file);
      const raw = rel === null ? undefined : cacheRef.current.get(rel);
      if (raw !== undefined) {
        const blocks = splitBlocks(parseFrontmatter(raw).body);
        for (const t of groups[i - 1][1]) found.set(t.id, whereOf(t, blocks));
      }
      if (i < files.length) frame = requestAnimationFrame(step);
      else setWhereById(found);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready, groups, root]);

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
        <nav className="w-[19rem] shrink-0 overflow-y-auto border-r border-[var(--mg-border)] bg-[var(--mg-panel)] py-2">
          {groups.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-[var(--mg-muted)]">
              指摘が付くとここに並びます。
            </p>
          )}
          {groups.map(([file, list]) => (
            <section key={file} className="mb-4">
              <h2 className="mg-review-group">
                <span className="mg-review-path">{pathLabel(root, file)}</span>
                <span className="mg-count">{list.length}</span>
                <button
                  onClick={() => void resolveFile(file, list)}
                  disabled={bulkFile !== null}
                  title="このファイルの指摘をすべて解決にする"
                  className="mg-bulk"
                >
                  <Icon
                    name={bulkFile === file ? "progress_activity" : "done_all"}
                    size={14}
                    className={bulkFile === file ? "mg-spin" : undefined}
                  />
                </button>
              </h2>
              {list.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  where={
                    whereById.get(thread.id) ?? thread.section_path.join(" › ")
                  }
                  active={thread.id === selected?.id}
                  onPick={() => setSelectedId(thread.id)}
                />
              ))}
            </section>
          ))}
        </nav>

        {threads.length === 0 ? (
          <p className="p-8 text-[13px] text-[var(--mg-muted)]">
            指摘を選ぶと、その箇所が今どうなっているかを本文の中で示します。
          </p>
        ) : pending || !shown ? (
          <DetailSkeleton />
        ) : (
          <ThreadDetail key={shown.id} thread={shown} />
        )}
      </div>
    </div>
  );
}

// 本文を組み立てている間の骨組み。読む場所の形をそのまま出しておくと、
// 中身が入ったときに視線が飛ばない。
function DetailSkeleton() {
  const widths = ["70%", "100%", "94%", "88%", "100%", "62%", "100%", "80%"];
  return (
    <div className="mg-loading flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="mg-progress" role="progressbar" aria-label="読み込み中" />
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="mg-skeleton">
            <div className="mg-skeleton-bar mg-skeleton-head" style={{ width: "45%" }} />
            {widths.map((w, i) => (
              <div key={i} className="mg-skeleton-bar" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>
      <aside className="mg-side">
        <div className="mg-side-head">読み込んでいます…</div>
        <div className="mg-talk">
          <div className="mg-skeleton w-full">
            <div className="mg-skeleton-bar" style={{ width: "60%" }} />
            <div className="mg-skeleton-bar" style={{ width: "85%" }} />
            <div className="mg-skeleton-bar" style={{ width: "45%" }} />
          </div>
        </div>
      </aside>
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
      <div className="mg-thread-quote">
        <span>{thread.selection || thread.quote}</span>
      </div>
      <div className="mg-thread-body">
        {thread.comments[0]?.body ?? "（本文なし）"}
      </div>
      <div className="mg-thread-foot">
        {/* 幅が狭いので、いちばん細かい節だけを出す。全体は title で読める。
            見出しを辿り終える前は何も出さない（後から入る） */}
        <span className="mg-thread-where" title={where}>
          {where.split(" › ").pop()}
        </span>
        {thread.comments.length > 1 && (
          <span className="mg-thread-count">
            <Icon name="forum" size={11} />
            {thread.comments.length}
          </span>
        )}
      </div>
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

function stateNote(anchor: Anchor): string {
  switch (anchor.state) {
    case "unchanged":
      return "指摘の箇所はまだ書き換わっていません。";
    case "rewritten":
      return "指摘の箇所は書き換わっています。指摘した時点の文を上に並べています。";
    case "removed":
      return "指摘の箇所は今の本文から削除されています。";
    default:
      return anchor.candidates.length === 0
        ? "指摘の文は今の本文に見当たらず、近そうな箇所も見つかりませんでした。"
        : `指摘の文は今の本文に見当たりません。近そうな箇所を ${anchor.candidates.length} つ挙げています。`;
  }
}

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
  // 表示用。押した直後の 2 回目を弾くのは下の ref で、こちらは見た目だけを持つ。
  const [busy, setBusy] = useState(false);
  // state は再描画されるまで更新されないので、素早い 2 回目のクリックが
  // 同じ値を読んで通り抜けてしまう。同期的に読める ref で締め出す。
  const running = useRef(false);
  // 押すたびに本文を指摘の箇所へ戻す。候補が複数あるときは次の候補へ送る。
  const [focus, setFocus] = useState({ nonce: 0, at: 0 });

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
    if (!text || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (await replyToThread(thread.id, REVIEW_AUTHOR, text)) {
        setReply("");
        await refreshLedger(store);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [reply, thread.id, store]);

  const finish = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (await resolveThread(thread.id, REVIEW_AUTHOR)) await refreshLedger(store);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [thread.id, store]);

  const style = { fontFamily: fontStack(font) };
  // 候補が複数あるときは、今どれを見ているかを出しつつ次へ送れるようにする。
  const candidates =
    view?.anchor.state === "unknown" ? view.anchor.candidates.length : 0;
  const hasTarget = view !== null && (view.anchor.state !== "unknown" || candidates > 0);
  const jump = () =>
    setFocus((f) => ({
      nonce: f.nonce + 1,
      at: candidates > 1 ? (f.at + 1) % candidates : 0,
    }));
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
                focusNonce={focus.nonce}
                focusAt={focus.at}
                selection={thread.selection}
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
          <button
            onClick={jump}
            disabled={!hasTarget}
            title={
              !hasTarget
                ? "指摘の箇所も、近そうな箇所も見つかっていません"
                : candidates > 1
                  ? "次の候補へ送る"
                  : "本文の指摘の箇所へ戻る"
            }
            className="mg-side-open"
          >
            <Icon name="my_location" size={13} />
            {candidates > 1 ? "次の候補へ" : "対象箇所へ"}
            {candidates > 1 && (
              <span className="mg-side-of">
                {focus.at + 1}/{candidates}
              </span>
            )}
          </button>
          {rel && (
            <button
              onClick={() => {
                openFile(rel);
                setScreen(false);
              }}
              title="読書ビューでこのファイルを開く"
              className="mg-side-open"
            >
              <Icon name="open_in_new" size={13} />
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

        <Quote
          quote={thread.quote}
          selection={thread.selection}
          offset={thread.selection_offset}
        />

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
            {stateNote(view.anchor)}
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
              <Icon
                name={busy ? "progress_activity" : "check_circle"}
                size={15}
                fill={!busy}
                className={busy ? "mg-spin" : undefined}
              />
              {busy ? "解決にしています…" : "解決にする"}
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
