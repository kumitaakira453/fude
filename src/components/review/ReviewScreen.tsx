import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAfterPaint } from "../../hooks/useAfterPaint";
import { useMarkdownKeys } from "../../hooks/useMarkdownKeys";
import { useWorkspace } from "../../hooks/useWorkspace";
import { anchorAt, landOn } from "../../lib/anchors";
import { lineRange, sectionPathAt, splitBlocks, type Block } from "../../lib/blocks";
import {
  SPOT_ICON,
  SPOT_NAME,
  changesSince,
  spotDiff,
  spotNote,
  type SpotDiff,
} from "../../lib/spotDiff";
import { copyText } from "../../lib/clip";
import { fontStack } from "../../lib/fonts";
import { answerOf } from "../../lib/versions";
import {
  REVIEW_LIST_WIDTH,
  REVIEW_SIDE_WIDTH,
  fitReviewListWidth,
  fitReviewSideWidth,
} from "../../lib/sidebar";
import { buildProjection } from "../../lib/projection";
import { inEditable, PAD_CLASS, WIDTH_CLASS } from "../../lib/ui";
import { parseFrontmatter } from "../../lib/frontmatter";
import { rootOf } from "../../lib/fsAccess";
import {
  awaitsMe,
  isOpen,
  RAIL_FILTERS,
  readVersion,
  replyToThread,
  answeredByAgent,
  editComment,
  removeThread,
  reopenThread,
  resolveThread,
  resolveThreads,
  restoreThread,
  reviewPrompt,
  REVIEW_AUTHOR,
  type ThreadFacts,
  type ReviewComment,
  type ReviewThread,
} from "../../lib/review";
import { runReviewUndo, setReviewUndo } from "../../lib/reviewUndo";
import { ago, whenText } from "../../lib/when";
import { notify } from "../../state/toast";
import {
  pathLabelAtom,
  readingWidthAtom,
  reviewFilterAtom,
  reviewGroupedAtom,
  reviewListWidthAtom,
  rootsAtom,
  reviewSideWidthAtom,
  contentCacheAtom,
  fontAtom,
} from "../../state/atoms";
import {
  ledgerAtom,
  syncLedger,
  reviewScreenAtom,
  reviewThreadAtom,
} from "../../state/review";
import { AutoTextarea } from "../AutoTextarea";
import { Icon } from "../Icon";
import { markdownContext } from "../MarkdownContext";
import { SidebarGrip } from "../SidebarGrip";
import { useFileBody } from "./useFileBody";
import { SelectionMenu } from "./SelectionMenu";
import { CommentComposer } from "./CommentComposer";
import { useReview } from "../../hooks/useReview";
import { CommentBody, CommentPreview, PreviewToggle } from "./CommentMarkdown";
import { DocumentView } from "./DocumentView";
import { Quote } from "./Quote";

// レビュー専用の画面。読書ビューに小窓を重ねる形では、スクロールで位置が崩れ、
// 指摘がどのブロックのことかも並べて見せられない。
// 本文は本文として読ませ、やり取りは横に置く。

// 並べている根の中のファイルなら、その道筋（本文の控えの鍵）。外なら null。
function insideOf(roots: readonly string[], file: string): string | null {
  return rootOf(roots, file) ? file : null;
}

// 一覧の見出しに出す名前と場所。絶対パスを丸ごと 1 行に流すと 4 行に折り返して
// 一覧そのものが読めなくなるので、ファイル名と「その手前の 2 階層」に分ける。
// 全体は title で読める。
const DIR_TAIL = 2;

// 一覧と見出しに出すファイルの道筋は label が決める。根の中なら根からの相対、
// 外なら絶対パスをそのまま出す。同じ名前のファイルが別の節に何枚もあるので、
// 名前だけでは見分けられない。
function fileLabel(label: (path: string) => string, file: string): { name: string; dir: string } {
  const path = label(file);
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  const tail = parts.filter(Boolean).slice(-DIR_TAIL);
  const cut = parts.filter(Boolean).length > tail.length;
  return { name, dir: tail.length === 0 ? "" : `${cut ? "…/" : ""}${tail.join("/")}` };
}

// 一覧と写しに添える、突き合わせて分かったこと。
interface Facts extends ThreadFacts {
  spot: SpotDiff;
}

function factsOf(
  thread: ReviewThread,
  file: string,
  blocks: Block[],
  body: string,
  shift: number,
  base: string | null,
): Facts {
  const spot = spotDiff(thread, blocks, base);
  const block = spot.index >= 0 ? (blocks[spot.index] ?? null) : null;
  // 消えたブロックには今の姿が無い。行も出せない。
  const here = spot.state === "removed" ? null : block;
  // その箇所を指すリンク。見出しの id は描くときと同じ算法で出すので、
  // 同じ見出しが複数ある文書でも連番まで一致する。
  const id = spot.index >= 0 ? anchorAt(blocks, spot.index) : null;
  return {
    spot,
    where: whereAt(spot, thread, blocks),
    state: SPOT_NAME[spot.state],
    lines: here ? lineRange(body, here, shift) : null,
    head: spot.state === "rewritten" || spot.state === "around" ? (here?.src ?? null) : null,
    anchor: id ? `${file}#${id}` : null,
  };
}

// 見出しを辿った道筋。決められなかった指摘は、指摘に残っている節を出す。
function whereAt(spot: SpotDiff, thread: ReviewThread, blocks: Block[]): string {
  const at = spot.index;
  if (at >= 0) {
    const path = sectionPathAt(blocks, Math.min(at, blocks.length - 1));
    if (path.length > 0) return path.join(" › ");
  }
  if (thread.section_path.length > 0) return thread.section_path.join(" › ");
  return "見出しの外";
}

// 最後に誰かが話した時刻。新しい順はこれで並べる。
function lastAt(thread: ReviewThread): number {
  return thread.comments[thread.comments.length - 1]?.created_at ?? thread.created_at;
}

// フロントマターの行数。本文の頭がファイルの何行目から始まるかを出す。
function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

export function ReviewScreen() {
  const ledger = useAtomValue(ledgerAtom);
  const cache = useAtomValue(contentCacheAtom);
  const roots = useAtomValue(rootsAtom);
  const label = useAtomValue(pathLabelAtom);
  const [selectedId, setSelectedId] = useAtom(reviewThreadAtom);
  const setScreen = useSetAtom(reviewScreenAtom);
  const store = useStore();
  // 一括解決の最中のファイル。そのファイルの見出しだけを処理中の見た目にする。
  const [bulkFile, setBulkFile] = useState<string | null>(null);
  const bulkRunning = useRef(false);
  // プロンプトを写したファイル。少しの間だけ印を出して、押せたことを示す。
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  // 突き合わせの結果は下で作る。押した瞬間に最新を読むため参照で持つ。
  const factsRef = useRef<Map<string, Facts>>(new Map());
  // 対象へ寄せ終わった指摘。ここが今見せている指摘と一致するまで骨組みを出す。
  const [settledId, setSettledId] = useState<string | null>(null);
  const markSettled = useCallback((id: string) => setSettledId(id), []);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // 削除と解決を ⌘Z で戻す。返信を書いている途中は、入力欄自身の undo に譲る。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      if (inEditable(e.target)) return;
      if (runReviewUndo()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 出すのは今開いているフォルダの中のファイルに付いた指摘だけ。外のものは
  // 本文を読めないので、どこへの指摘かを示せず、返信も解決も当て推量になる。
  // 数だけは伝える（消えたのではなく、そのフォルダを開けば出ると分かるように）。
  const inFolder = useMemo(
    () =>
      roots.length === 0
        ? ledger.threads
        : ledger.threads.filter((t) => insideOf(roots, t.file) !== null),
    [ledger, roots],
  );
  const elsewhere = useMemo(
    () => ledger.threads.filter(isOpen).length - inFolder.filter(isOpen).length,
    [ledger, inFolder],
  );
  const [filter, setFilter] = useAtom(reviewFilterAtom);
  const [grouped, setGrouped] = useAtom(reviewGroupedAtom);
  const [listWidth, setListWidth] = useAtom(reviewListWidthAtom);
  const listRef = useRef<HTMLElement>(null);
  const counts = useMemo(() => {
    const open = inFolder.filter(isOpen);
    return { todo: open.filter(awaitsMe).length, open: open.length };
  }, [inFolder]);
  // 解決にする（解決済みの一覧では未解決に戻す）と、押した瞬間から一覧に出さない。
  // 台帳への書き込みと読み直しは背後で進むので、それを待ってから消すと、押しても
  // 何も起きない間ができる。しくじったら戻す（台帳が変わらなければそのまま戻る）。
  const [going, setGoing] = useState<ReadonlySet<string>>(() => new Set());
  const goingRef = useRef(going);
  goingRef.current = going;
  const threads = useMemo(() => {
    const done = filter === "done";
    const list = inFolder.filter((t) => {
      if (going.has(t.id)) return false;
      if (isOpen(t) === done) return false;
      // 見ている指摘は、返信して「未対応」から外れても選び直すまで残す。
      // 返した瞬間に一覧から消えると、読んでいた場所ごと飛ばされる。
      return filter !== "todo" || awaitsMe(t) || t.id === selectedId;
    });
    // 新しい順は最後の発言の時刻で並べる。まとめるときはファイルごとに寄せる。
    list.sort((x, y) => lastAt(y) - lastAt(x));
    if (grouped) list.sort((x, y) => x.file.localeCompare(y.file));
    return list;
    // 選び直しのたびに並びを組み直さないよう、選んでいる id は見張らない
    // （残すかどうかは、絞り込みや台帳が変わったときにだけ決め直せば足りる）。
  }, [inFolder, going, filter, grouped]);
  // 解決の処理の中で「次の指摘」を引くための控え。押した瞬間の並びを見る。
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

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
  // 待っているあいだは前に出していたものを残す（上に骨組みを重ねて隠す）。
  // 消すと右の詳しい表示が作り直しになり、同じファイルでも本文を組み直す。
  const lastShown = useRef<ReviewThread | null>(null);
  const shown = useMemo(() => {
    if (pending) return lastShown.current;
    const next = pick(shownId ?? null);
    lastShown.current = next;
    return next;
  }, [pending, pick, shownId]);
  // 解決した後に見せる指摘。決めておかないと、選択が暗黙で先頭へ倒れて
  // 中央ペインが作り直され、一瞬ちらつく。
  const nextId = useMemo(() => {
    const i = threads.findIndex((t) => t.id === shown?.id);
    if (i < 0) return null;
    return threads[i + 1]?.id ?? threads[i - 1]?.id ?? null;
  }, [threads, shown]);

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
    return [...byFile.entries()];
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
          `${name} の未解決 ${list.length} 件をすべて解決にします。`,
          { title: "fude", kind: "warning" },
        );
        if (!ok) return;
        const ids = list.map((t) => t.id);
        const done = await resolveThreads(ids, REVIEW_AUTHOR);
        if (done !== null) {
          await syncLedger(store);
          const restore = async () => {
            setReviewUndo(null);
            for (const id of ids) await reopenThread(id);
            await syncLedger(store);
            notify(store, `${ids.length} 件を未解決に戻しました`);
          };
          setReviewUndo(restore);
          notify(store, `${done} 件を解決にしました`, "center", {
            label: "元に戻す",
            run: () => void restore(),
          });
        }
      } finally {
        bulkRunning.current = false;
        setBulkFile(null);
      }
    },
    [store],
  );

  // 指摘を 1 件、解決にする。一覧の札・キー操作・右の欄の釦が同じ道を通る。
  //
  // 解決にすると一覧から消えるので、それを見ていたときだけ次の指摘へ送る
  // （一覧の別の札から解決したときは、見ているものを動かさない）。
  const resolveOne = useCallback(
    async (id: string) => {
      if (goingRef.current.has(id)) return;
      const list = threadsRef.current;
      const i = list.findIndex((t) => t.id === id);
      const next = list[i + 1]?.id ?? list[i - 1]?.id ?? null;
      // 先に下げて、見ていた指摘なら次へ送る。ここまでは押した一枚で終わる。
      setGoing((prev) => new Set(prev).add(id));
      if (store.get(reviewThreadAtom) === id) setSelectedId(next);
      // 解決済みの一覧から押したときは、未解決に戻す。
      const back = store.get(reviewFilterAtom) === "done";
      try {
        if (!(back ? await reopenThread(id) : await resolveThread(id, REVIEW_AUTHOR))) return;
        await syncLedger(store);
        const restore = async () => {
          setReviewUndo(null);
          if (!(back ? await resolveThread(id, REVIEW_AUTHOR) : await reopenThread(id))) return;
          setSelectedId(id);
          await syncLedger(store);
          notify(store, back ? "解決済みに戻しました" : "未解決に戻しました");
        };
        setReviewUndo(restore);
        notify(store, back ? "未解決に戻しました" : "解決にしました", "center", {
          label: "元に戻す",
          run: () => void restore(),
        });
      } finally {
        setGoing((prev) => {
          const rest = new Set(prev);
          rest.delete(id);
          return rest;
        });
      }
    },
    [setSelectedId, store],
  );

  // いま選んでいる指摘を解決にする。⌘D（サイドバー）と重ならないよう ⇧ を足す。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== "d" && e.key !== "D") return;
      const id = store.get(reviewThreadAtom);
      if (!id) return;
      e.preventDefault();
      void resolveOne(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolveOne, store]);

  // 1 ファイル分の指摘を、そのままエージェントへ渡せる形にして写す。
  // 突き合わせの結果は一覧づくりで既に組んであるので、押した瞬間に組み直さない。
  const copyPrompt = useCallback(
    (file: string, list: ReviewThread[]) => {
      const text = reviewPrompt(label(file), list, (t) =>
        factsRef.current.get(t.id),
      );
      void copyText(text).then((done) => {
        if (!done) {
          notify(store, "コメントを写せませんでした");
          return;
        }
        notify(store, "コメントを写しました");
        setCopiedFile(file);
        window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopiedFile(null), 1400);
      });
    },
    [label, store],
  );

  // 今出ている指摘をまとめて写す。ファイルごとに組んでつなげる。
  const copyAll = useCallback(() => {
    if (groups.length === 0) return;
    const text = groups
      .map(([file, list]) => reviewPrompt(label(file), list, (t) => factsRef.current.get(t.id)))
      .join("\n\n");
    void copyText(text).then((done) =>
      notify(store, done ? `${threads.length} 件のコメントを写しました` : "コメントを写せませんでした"),
    );
  }, [groups, label, store, threads.length]);

  // ↑↓ で一覧の前後へ移る。入力欄の中では字の送りに譲る。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (inEditable(e.target)) return;
      const list = threadsRef.current;
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.findIndex((t) => t.id === store.get(reviewThreadAtom));
      const to = e.key === "ArrowDown" ? Math.min(at + 1, list.length - 1) : Math.max(at - 1, 0);
      const id = list[at < 0 ? 0 : to].id;
      setSelectedId(id);
      document
        .querySelector(`[data-thread-row="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedId, store]);

  // 一覧に出す「どこの話か」と「その箇所が今どうなっているか」。文書をブロックへ
  // 割り、指摘ごとに見出しを辿って版と突き合わせる重い処理なので、描画の中では
  // なくファイル 1 枚ずつフレームを分けて進める。まとめてやると数百ミリ秒画面が
  // 固まり、選択にも反応できなくなる。
  const [factsById, setFactsById] = useState<Map<string, Facts>>(new Map());
  factsRef.current = factsById;
  // 索引づくりの途中は本文の控えが何度も差し替わる。それに引きずられて
  // 辿り直しをやり直すと、いつまでも終わらないので参照だけ持っておく。
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const found = new Map<string, Facts>();
    // 次のフレームまで待つ。ここで手を離すので、一覧の操作が詰まらない。
    const yieldFrame = () =>
      new Promise<void>((done) => requestAnimationFrame(() => done()));
    void (async () => {
      for (const [file, list] of groups) {
        const key = insideOf(roots, file);
        const raw = key === null ? undefined : cacheRef.current.get(key);
        if (raw !== undefined) {
          const { body } = parseFrontmatter(raw);
          // 本文がファイルの何行目から始まるか（フロントマターの行数）。
          const shift = countLines(raw.slice(0, raw.length - body.length));
          const blocks = splitBlocks(body);
          for (const t of list) {
            // 版の本文は id で覚えているので、2 度目からは取りに行かない。
            const base = await readVersion(t.base_version);
            if (!alive) return;
            found.set(t.id, factsOf(t, label(file), blocks, body, shift, base));
          }
        }
        await yieldFrame();
        if (!alive) return;
      }
      setFactsById(found);
    })();
    return () => {
      alive = false;
    };
  }, [ready, groups, roots, label]);

  const row = (thread: ReviewThread) => (
    <ThreadCard
      key={thread.id}
      thread={thread}
      where={factsById.get(thread.id)?.where ?? thread.section_path.join(" › ")}
      file={grouped ? null : fileLabel(label, thread.file).name}
      active={thread.id === selected?.id}
      onPick={() => setSelectedId(thread.id)}
      onResolve={() => void resolveOne(thread.id)}
    />
  );

  return (
    <div className="mg-review flex h-screen w-screen flex-col overflow-hidden bg-[var(--mg-bg)] text-[var(--mg-fg)]">
      <header className="mg-review-head mg-screenbar" data-tauri-drag-region>
        <Icon name="comment" size={16} className="text-[var(--mg-accent)]" />
        <div className="mg-screenbar-title" data-tauri-drag-region>
          <span className="mg-screenbar-kind">コメント一覧</span>
          {elsewhere > 0 && (
            <span className="text-[length:11px] text-[var(--mg-muted)]">
              他のフォルダに {elsewhere} 件
            </span>
          )}
        </div>
        <span className="flex-1" />
        <div className="mg-seg" role="group" aria-label="絞り込み">
          {RAIL_FILTERS.filter((f) => f.id !== "all").map((f) => (
            <button
              key={f.id}
              aria-pressed={filter === f.id}
              title={f.note}
              onClick={() => setFilter(f.id === "todo" || f.id === "open" ? f.id : "done")}
            >
              {f.name}
              {f.id !== "done" && (
                <span className="mg-seg-n">{f.id === "todo" ? counts.todo : counts.open}</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={copyAll}
          disabled={threads.length === 0}
          className="mg-tbtn"
          title="出ているコメントを AI 用のプロンプトとして写す"
        >
          <Icon name="content_copy" size={13} />
          AI に渡す
        </button>
        <button
          onClick={() => setScreen(false)}
          className="mg-tbtn"
          data-tip="閉じる"
          data-key="Esc"
        >
          <Icon name="close" size={13} stroke={1.7} />
          閉じる
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav ref={listRef} className="mg-inbox" style={{ width: listWidth }}>
          <div className="mg-inbox-head">
            <span className="flex-1">{grouped ? "ファイルごと" : "新しい順・ファイルをまたいで 1 本"}</span>
            <button
              onClick={() => setGrouped(!grouped)}
              aria-pressed={grouped}
              className={`mg-tbtn is-quiet${grouped ? " is-on" : ""}`}
            >
              ファイルでまとめる
            </button>
          </div>
          <div className="mg-inbox-list">
            {threads.length === 0 && (
              <p className="mg-inbox-none">
                {filter === "todo"
                  ? "未対応のコメントはありません。片付いています。"
                  : filter === "open"
                    ? "未解決のコメントはありません。"
                    : "解決済みのコメントはありません。"}
                {elsewhere > 0 && filter !== "done" && " 他のフォルダのコメントは、そのフォルダを開くと出ます。"}
              </p>
            )}
            {grouped
              ? groups.map(([file, list]) => (
                  <section key={file}>
                    <h2 className="mg-inbox-file" title={file}>
                      <span className="mg-inbox-file-name">
                        <bdi>{label(file)}</bdi>
                      </span>
                      <span className="mg-inbox-file-n">{list.length}</span>
                      <button
                        onClick={() => copyPrompt(file, list)}
                        title="このファイルのコメントを AI 用のプロンプトとして写す"
                        className="mg-bulk"
                      >
                        <Icon name={copiedFile === file ? "check" : "content_copy"} size={13} />
                      </button>
                      {filter !== "done" && (
                        <button
                          onClick={() => void resolveFile(file, list)}
                          disabled={bulkFile !== null}
                          title="このファイルのコメントをすべて解決にする"
                          className="mg-bulk"
                        >
                          <Icon
                            name={bulkFile === file ? "progress_activity" : "done_all"}
                            size={13}
                            className={bulkFile === file ? "mg-spin" : undefined}
                          />
                        </button>
                      )}
                    </h2>
                    {list.map((thread) => row(thread))}
                  </section>
                ))
              : threads.map((thread) => row(thread))}
          </div>
        </nav>
        <SidebarGrip
          target={listRef}
          width={listWidth}
          onWidth={setListWidth}
          fit={fitReviewListWidth}
          reset={REVIEW_LIST_WIDTH}
        />

        {threads.length === 0 ? (
          <p className="p-8 text-[length:13px] text-[var(--mg-muted)]">
            コメントを選ぶと、その箇所が今どうなっているかを本文の中で示します。
          </p>
        ) : !shown ? (
          <DetailSkeleton />
        ) : (
          // 骨組みは差し替えではなく上に重ねる。差し替えにすると、押した瞬間の
          // 描画に前の本文の破棄が混ざり、左ペインの選択が切り替わる絵が
          // そのぶん遅れて出る。重ねるだけなら押した瞬間に描き終わる。
          //
          // 外すのは「本文が出た瞬間」ではなく「対象へ寄せ終わった瞬間」。
          // 先に外すと、本文が出てから対象へ動くまでの間が待たされて見える。
          <div className="relative flex min-w-0 flex-1">
            <ThreadDetail
              // 同じファイルのあいだは作り直さない。本文の組み立て直しで、
              // 選ぶたびに 1 秒以上固まっていた。コメントごとの状態は中で戻す。
              key={shown.file}
              thread={shown}
              nextId={nextId}
              onResolve={resolveOne}
              onSettled={markSettled}
            />
            {(pending || settledId !== shown.id) && (
              <div className="absolute inset-0 z-10 flex bg-[var(--mg-bg)]">
                <DetailSkeleton />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 本文を組み立てている間の骨組み。読む場所の形をそのまま出しておくと、
// 中身が入ったときに視線が飛ばない。
function DetailSkeleton() {
  const widths = ["70%", "100%", "94%", "88%", "100%", "62%", "100%", "80%"];
  // 右の欄は掴んで幅を変えられる。骨組みも同じ幅で出す（入れ替わる瞬間に
  // 欄の幅が動くと、読んでいる場所が横へ飛ぶ）。
  const sideWidth = useAtomValue(reviewSideWidthAtom);
  const width = useAtomValue(readingWidthAtom);
  return (
    <div className="mg-loading flex min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mg-pathbar" />
        <div
          className="mg-progress absolute inset-x-0 top-[27px]"
          role="progressbar"
          aria-label="読み込み中"
        />
        <div className={`pt-8 ${PAD_CLASS[width]}`}>
          <div className={`mx-auto ${WIDTH_CLASS[width]}`}>
            <div className="mg-skeleton">
              <div className="mg-skeleton-bar mg-skeleton-head" style={{ width: "45%" }} />
              {widths.map((w, i) => (
                <div key={i} className="mg-skeleton-bar" style={{ width: w }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <aside className="mg-side" style={{ width: sideWidth }}>
        <div className="mg-side-head">
          <span className="mg-side-title">コメント</span>
        </div>
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

// 一覧に出す指摘の 1 行。組版はせず、記法だけを落として字の並びに均す
// （`**強調**` の記号が本文として読まれないようにする）。
const bodyCache = new Map<string, string>();

function bodyLine(body: string): string {
  const hit = bodyCache.get(body);
  if (hit !== undefined) return hit;
  const plain = buildProjection(body).plain.replace(/\s+/g, " ").trim();
  const line = plain || body.replace(/\s+/g, " ").trim();
  bodyCache.set(body, line);
  return line;
}

export function ThreadCard({
  thread,
  where,
  file,
  active,
  onPick,
  onResolve,
}: {
  thread: ReviewThread;
  where: string;
  // ファイルをまたいで並べるときに添えるファイル名。まとめているときは見出しにあるので無い。
  file: string | null;
  active: boolean;
  onPick: () => void;
  onResolve: () => void;
}) {
  const open = isOpen(thread);
  const mine = open && awaitsMe(thread);
  const section = where.split(" › ").pop();
  return (
    // 釦の中に釦は置けないので、行そのものは div で受ける（押す・Enter・Space
    // は自分で見る）。解決の釦は押した先を分ける。
    <div
      role="button"
      tabIndex={0}
      data-thread-row={thread.id}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onPick();
      }}
      className={`mg-thread-card${active ? " is-active" : ""}${open ? "" : " is-done"}`}
    >
      {/* 自分が応える番（未対応）は塗った点、相手の返事を待っているものは枠だけ。 */}
      <span
        className={`mg-thread-dot${mine ? " is-todo" : open ? " is-wait" : ""}`}
        title={mine ? "未対応" : open ? "返事待ち" : "解決済み"}
      />
      <span className="mg-thread-body">
        {bodyLine(thread.comments[0]?.body ?? "") || "（本文なし）"}
      </span>
      <span className="mg-thread-when" title={whenText(lastAt(thread))}>
        {ago(lastAt(thread))}
      </span>
      {/* どこの話か。見出しを辿り終える前は指摘に残っている節を出す（後から入る）。 */}
      <span className="mg-thread-where" title={where}>
        {file && <span className="mg-thread-file">{file}</span>}
        {file && section ? "・" : ""}
        {section}
      </span>
      <span className="mg-thread-state">
        {open && answeredByAgent(thread) && mine ? (
          <span className="mg-ws-pill-badge is-agent" title="AI からの返信が届いています">
            返信あり
          </span>
        ) : open && !mine ? (
          <span>返事待ち</span>
        ) : null}
        {thread.comments.length > 1 && (
          <span className="mg-thread-count" title={`${thread.comments.length} 件のやり取り`}>
            {thread.comments.length}
          </span>
        )}
      </span>
      {/* 指した行と選んだ行に重ねて出す。場所は空けたままにして、出入りで字を動かさない。 */}
      <button
        type="button"
        title={open ? "解決にする（⌘⇧D）" : "未解決に戻す（⌘⇧D）"}
        className="mg-thread-done"
        onClick={(e) => {
          e.stopPropagation();
          onResolve();
        }}
      >
        <Icon name={open ? "check" : "undo"} size={13} />
      </button>
    </div>
  );
}

function ThreadDetail({
  thread,
  nextId,
  onResolve,
  onSettled,
}: {
  thread: ReviewThread;
  // 消したときに見せる次の指摘。
  nextId: string | null;
  // 解決の道は画面が持つ（一覧の札・キー操作と同じものを通す）。
  onResolve: (id: string) => Promise<void>;
  onSettled: (id: string) => void;
}) {
  const store = useStore();
  const setSelectedId = useSetAtom(reviewThreadAtom);
  const ledger = useAtomValue(ledgerAtom);
  const roots = useAtomValue(rootsAtom);
  const label = useAtomValue(pathLabelAtom);
  const font = useAtomValue(fontAtom);
  const setScreen = useSetAtom(reviewScreenAtom);
  const { openFile, navigate, resolveAsset, peekAsset } = useWorkspace();
  const [baseText, setBaseText] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  // 書いたものの姿を確かめている間。送ると書く側へ戻す。
  const [seeReply, setSeeReply] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  // 書く側へ戻したら焦点も戻す。入力欄は出し直しになるので、描き直しのあとに当てる。
  const flipReply = () =>
    setSeeReply((v) => {
      if (v) requestAnimationFrame(() => replyRef.current?.focus());
      return !v;
    });
  const md = useMarkdownKeys(setReply, flipReply);
  // 表示用。返信と解決は別の操作なので別に持つ。1 つにすると、返信しただけで
  // 解決のボタンまで処理中の見た目になる。
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // state は再描画されるまで更新されないので、素早い 2 回目のクリックが
  // 同じ値を読んで通り抜けてしまう。同期的に読める ref で締め出す。
  const sendingRef = useRef(false);
  const resolvingRef = useRef(false);
  const removingRef = useRef(false);
  // 押すたびに本文を指摘の箇所へ戻す。
  const [focus, setFocus] = useState(0);
  // 「次の変更へ」で今見ている所。
  const [goTo, setGoTo] = useState<{ at: number; nonce: number } | null>(null);

  // 同じファイルの別のコメントへ移ったら、コメントごとに持つものを戻す。
  // 描く前に戻すので、前のコメントの返信の下書きが一瞬でも出ることはない。
  const [seenId, setSeenId] = useState(thread.id);
  if (seenId !== thread.id) {
    setSeenId(thread.id);
    setReply("");
    setSeeReply(false);
    setSending(false);
    setResolving(false);
    setRemoving(false);
    setFocus(0);
    setGoTo(null);
    sendingRef.current = false;
    resolvingRef.current = false;
    removingRef.current = false;
  }

  // 本文の控えの鍵（絶対パス）。開いているフォルダの外なら null。
  const rel = useMemo(() => insideOf(roots, thread.file), [roots, thread.file]);
  // 場所の段に出す道筋。一覧の見出しと違って幅があるので、省かずに全部出す。
  const path = useMemo(() => label(thread.file).split("/").filter(Boolean), [label, thread.file]);
  const width = useAtomValue(readingWidthAtom);

  const { body: currentBody, raw, reading } = useFileBody(rel);
  // 右の欄の幅。掴んでいるあいだは仕切りが DOM へ直に書き、離したら控える。
  const [sideWidth, setSideWidth] = useAtom(reviewSideWidthAtom);
  const sideRef = useRef<HTMLElement>(null);
  // 出している本文の入れ物。ここで選んだ字に対してコメントを書く。
  const [paper, setPaper] = useState<HTMLElement | null>(null);
  const write = useReview({
    absPath: thread.file,
    body: currentBody ?? "",
    raw,
    content: paper,
    isActive: true,
  });

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

  // ブロックへの分割と、版からの動きは本文と版だけで決まる。同じファイルの
  // コメントを渡り歩くあいだは作り直さない。
  const blocks = useMemo(
    () => (currentBody === null ? null : splitBlocks(currentBody)),
    [currentBody],
  );
  const moved = useMemo(
    () => (blocks === null || baseText === null ? [] : changesSince(baseText, blocks)),
    [baseText, blocks],
  );
  const view = useMemo(() => {
    if (blocks === null) return null;
    const spot = spotDiff(thread, blocks, baseText);
    // 指摘の箇所の外で動いた所。コメントへの対応は、指摘された塊の外で
    // 行われることがある。
    const changes = moved.filter((c) => c.index !== spot.index);
    const crumbs =
      spot.state === "unknown"
        ? thread.section_path
        : sectionPathAt(blocks, Math.min(spot.index, blocks.length - 1));
    return { blocks, spot, changes, crumbs };
  }, [baseText, blocks, moved, thread]);

  // その指摘への対応の記録（AI が直したあとに打つ版）。これが今の本文と同じなら、
  // 動いた分は「その対応そのもの」と言い切れる。違えば、そのあとの編集も
  // 混ざっているので言い方を変える。
  const answer = useMemo(() => answerOf(ledger, thread), [ledger, thread]);
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    let alive = true;
    setAnswered(false);
    if (!answer || raw === undefined) return;
    void readVersion(answer.id).then((text) => {
      if (alive) setAnswered(text !== null && text === raw);
    });
    return () => {
      alive = false;
    };
  }, [answer, raw]);

  // 「次の変更へ」。指摘の箇所の外で動いた所を順に送る。
  const nextChange = () => {
    const list = view?.changes ?? [];
    if (list.length === 0) return;
    setGoTo((was) => {
      const i = list.findIndex((c) => c.index === was?.at);
      const next = list[(i + 1) % list.length] ?? list[0];
      return { at: next.index, nonce: (was?.nonce ?? 0) + 1 };
    });
  };

  const settle = useCallback(() => onSettled(thread.id), [onSettled, thread.id]);
  // 本文を出せないと分かったときは、寄せる先が無いので待たせない。
  // 読んでいる最中はまだ分からないので、骨組みを出したまま待つ。
  useEffect(() => {
    if (currentBody === null && !reading) settle();
  }, [currentBody, reading, settle]);

  // 本文と、コメントの中に書かれたリンクの行き先。相対パスの基準は、
  // コメントではなく指摘が付いているファイル。
  const landRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => landRef.current?.(), []);
  const ctx = useMemo(
    () => ({
      // 別のファイルは読む画面で開く。レビュー画面には出ていない本文なので、
      // ここで開いても行き先が無い。
      onNavigate: (href: string) => {
        if (!rel) return;
        navigate(rel, href);
        setScreen(false);
      },
      onAnchor: (id: string) => {
        landRef.current?.();
        if (!paper || !id) return;
        landRef.current = landOn(paper, id, () =>
          notify(store, "その見出しは見つかりません"),
        );
      },
      resolveAsset: (src: string) => resolveAsset(rel ?? "", src),
      peekAsset: (src: string) => peekAsset(rel ?? "", src),
      docPath: rel ?? "",
    }),
    [rel, resolveAsset, peekAsset, navigate, setScreen, paper, store],
  );

  const send = useCallback(async () => {
    const text = reply.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      if (await replyToThread(thread.id, REVIEW_AUTHOR, text)) {
        setReply("");
        setSeeReply(false);
        await syncLedger(store);
        notify(store, "返信しました");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [reply, thread.id, store]);

  const onReplyKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
      return;
    }
    md.onKeyDown(e);
  };

  const finish = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    try {
      await onResolve(thread.id);
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [thread.id, onResolve]);

  // 解決とは意味が違う操作。片付いた記録ではなく、指摘そのものを取り消す。
  // 確認は出さず、戻せるようにする（消す前の姿をそのまま台帳へ戻す）。
  const drop = useCallback(async () => {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    try {
      const before = thread;
      if (await removeThread(thread.id)) {
        setSelectedId(nextId);
        await syncLedger(store);
        const restore = async () => {
          setReviewUndo(null);
          if (!(await restoreThread(before))) return;
          setSelectedId(before.id);
          await syncLedger(store);
          notify(store, "コメントを戻しました");
        };
        setReviewUndo(restore);
        notify(store, "コメントを削除しました", "center", {
          label: "元に戻す",
          run: () => void restore(),
        });
      }
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  }, [thread, nextId, setSelectedId, store]);

  // --- 書き込みの書き直し
  const rewrite = useCallback(
    async (comment: string, body: string) => {
      if (await editComment(thread.id, comment, body)) {
        await syncLedger(store);
        notify(store, "書き込みを直しました");
      }
    },
    [thread.id, store],
  );

  const style = { fontFamily: fontStack(font) };
  const hasTarget = view !== null && view.spot.state !== "unknown";
  const open = isOpen(thread);
  const jump = () => setFocus((n) => n + 1);
  // 会話を左右に振る。指摘を出した人（＝最初に発言した人）を右に置く。
  const reviewer =
    thread.comments.find((c) => !AGENT_AUTHORS.has(c.author))?.author ?? REVIEW_AUTHOR;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 何を読んでいるか。本文の画面の場所の段と同じ寸法で置く。 */}
        <div className="mg-pathbar">
          {/* 長いときはフォルダの側を省く。ファイル名は最後まで出す。 */}
          <span className="mg-pathbar-path mg-review-path" title={thread.file}>
            {path.length > 1 && (
              <>
                <span className="mg-review-path-dir">{path.slice(0, -1).join(" / ")}</span>
                <span className="mg-crumb-sep">/</span>
              </>
            )}
            <span className="mg-crumb is-last">{path[path.length - 1]}</span>
          </span>
          <button
            onClick={jump}
            disabled={!hasTarget}
            title={
              hasTarget
                ? "本文のコメントの箇所へ戻る"
                : "コメントの箇所が今の本文のどこかを決められていません"
            }
            className="mg-tbtn is-quiet"
          >
            <Icon name="my_location" size={13} />
            対象箇所へ
          </button>
          {rel && (
            <button
              onClick={() => {
                openFile(rel);
                setScreen(false);
              }}
              title="読書ビューでこのファイルを開く"
              className="mg-tbtn is-quiet"
            >
              <Icon name="open_in_new" size={13} />
              ファイルを開く
            </button>
          )}
        </div>
        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto pt-8 ${PAD_CLASS[width]}`}>
          <div ref={setPaper} className={`mx-auto pb-8 ${WIDTH_CLASS[width]}`}>
            {rel === null ? (
              <p className="text-[12px] text-[var(--mg-muted)]">
                このファイルは今開いているフォルダの中にないため、現在の本文を出せません。
              </p>
            ) : currentBody === null && !reading ? (
              <p className="text-[12px] text-[var(--mg-muted)]">
                このファイルの本文を読めませんでした。
              </p>
            ) : view === null ? (
              <p className="text-[12px] text-[var(--mg-muted)]">読み込んでいます…</p>
            ) : (
              <markdownContext.Provider value={ctx}>
                <DocumentView
                  blocks={view.blocks}
                  spot={view.spot}
                  changes={view.changes}
                  answered={answered}
                  goTo={goTo}
                  style={style}
                  focusNonce={focus}
                  selection={thread.selection}
                  subject={thread.id}
                  onSettled={settle}
                />
              </markdownContext.Provider>
            )}
          </div>
        </div>
      </div>

      {/* 読んでいる最中に気付いたことを、その場で書けるようにする。選択と
          入力の作りは本文の画面と同じ（同じ部品・同じ決まり）。 */}
      {write.selection && !write.draft && (
        <SelectionMenu
          at={write.selection.rect}
          within={paper?.parentElement}
          onComment={write.startDraft}
        />
      )}
      {write.draft && (
        <CommentComposer
          anchorRect={write.draft.hit}
          selection={write.draft.text}
          source={write.draft.whole ? write.draft.quote : undefined}
          busy={write.busy}
          onSubmit={(text: string) => void write.submit(text)}
          onClose={write.close}
        />
      )}

      <SidebarGrip
        target={sideRef}
        width={sideWidth}
        onWidth={setSideWidth}
        side="right"
        fit={fitReviewSideWidth}
        reset={REVIEW_SIDE_WIDTH}
      />
      <aside ref={sideRef} className="mg-side" style={{ width: sideWidth }}>
        <div className="mg-side-head">
          <span className="mg-side-title">やり取り</span>
          {/* 箇所が今どうなっているか。返信を書く前にいちばん見たいので頭に置く。 */}
          {view && <SpotChip spot={view.spot} />}
        </div>

        <nav className="mg-crumbs">
          {(view?.crumbs.length ? view.crumbs : ["見出しの外"]).map((name, i) => (
            <span key={`${i}-${name}`}>
              {i > 0 && <span className="sep">/</span>}
              {name}
            </span>
          ))}
        </nav>

        {/* 引用の中の相対パス画像も本文と同じ文脈で解く。 */}
        <markdownContext.Provider value={ctx}>
          <Quote
            quote={thread.quote}
            selection={thread.selection}
            offset={thread.selection_offset}
          />
        </markdownContext.Provider>

        {/* コメントの中のリンクも、本文と同じ文脈で解く（基準は指摘の
            付いているファイル）。 */}
        <markdownContext.Provider value={ctx}>
          <div className="mg-talk">
            {thread.comments.map((c, i) => (
              <Message
                key={c.id}
                comment={c}
                mine={c.author === reviewer}
                run={thread.comments[i - 1]?.author === c.author}
                onRewrite={(body) => void rewrite(c.id, body)}
              />
            ))}
          </div>
        </markdownContext.Provider>

        {view && view.changes.length > 0 && (
          <div className="mg-side-changes">
            <Icon name="difference" size={13} className="mt-px shrink-0" />
            <span className="flex-1">
              {answered
                ? `この対応で、他に ${view.changes.length} か所が動いています`
                : `コメント時点から、他に ${view.changes.length} か所が動いています`}
              {answered && answer?.label && (
                <span className="mg-side-answer">{answer.label}</span>
              )}
            </span>
            <button onClick={nextChange} className="mg-tbtn mg-side-next">
              次の変更へ
            </button>
          </div>
        )}

        <div className="mg-side-compose">
          {seeReply ? (
            <CommentPreview body={reply} onKeyDown={onReplyKey} />
          ) : (
            <AutoTextarea
              ref={replyRef}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyUp={md.onKeyUp}
              onCompositionStart={md.onCompositionStart}
              onCompositionEnd={md.onCompositionEnd}
              onKeyDown={onReplyKey}
              minRows={2}
              maxRows={10}
              placeholder="返信を書く…（記法が使えます）"
              className="mg-field"
            />
          )}
          {/* 送り方の案内は入力欄の外に置く。プレースホルダに混ぜると、
              書き始めたとたんに読めなくなる。 */}
          <div className="mg-side-row">
            <PreviewToggle on={seeReply} onToggle={flipReply} />
            <span className="mg-side-hint">
              <kbd className="mg-key">⌘Enter</kbd> で送信
            </span>
            <button
              onClick={() => void send()}
              disabled={sending || !reply.trim()}
              className="mg-send"
            >
              <Icon
                name={sending ? "progress_activity" : "send"}
                size={13}
                className={sending ? "mg-spin" : undefined}
              />
              {sending ? "送っています…" : "返信"}
            </button>
          </div>
        </div>

        {/* この指摘の始末。返信は会話の続きで、こちらは終わらせる操作。
            塗った箱を並べると同じ強さの矩形が 4 つになって読めないので、
            目立つ操作は返信ひとつに絞り、ここは文字だけで置く。 */}
        <div className="mg-side-close">
          <button
            onClick={() => void finish()}
            disabled={resolving}
            className="mg-tbtn mg-side-done"
          >
            <Icon
              name={resolving ? "progress_activity" : open ? "check" : "undo"}
              size={13}
              className={resolving ? "mg-spin" : undefined}
            />
            {open ? (resolving ? "解決にしています…" : "解決にする") : "未解決に戻す"}
            <kbd className="mg-key">⌘⇧D</kbd>
          </button>
          <button
            onClick={() => void drop()}
            disabled={removing}
            title="コメントそのものを取り消す（解決の記録は残らない）"
            className="mg-tbtn mg-side-drop"
          >
            <Icon
              name={removing ? "progress_activity" : "delete"}
              size={13}
              className={removing ? "mg-spin" : undefined}
            />
            削除
          </button>
          <span className="mg-side-hint text-right">↑↓ で次のコメントへ</span>
        </div>
      </aside>
    </div>
  );
}

// 指摘の箇所が今どうなっているか。やり取りの頭にチップで置き、説明は title で読ませる。
//
// 色だけでは状態を言い分けられない（テーマによって danger とアクセントが
// 同系色になる）。記号と語を必ず添える。
function SpotChip({ spot }: { spot: SpotDiff }) {
  const moved = spot.added > 0 || spot.removed > 0;
  return (
    <span className={`mg-ws-pill-badge mg-spot-chip is-${spot.state}`} title={spotNote(spot)}>
      <Icon name={SPOT_ICON[spot.state]} size={11} fill />
      {SPOT_NAME[spot.state]}
      {moved && (
        <span className="mg-spot-delta">
          {spot.added > 0 && <span className="is-add">＋{spot.added}</span>}
          {spot.removed > 0 && <span className="is-del">−{spot.removed}</span>}
        </span>
      )}
    </span>
  );
}

// 答える側の顔。エージェントには機械らしい印を出し、人には人の印を出す。
const AGENT_AUTHORS = new Set(["AI", "ai", "assistant", "claude"]);

function Message({
  comment,
  mine,
  run,
  onRewrite,
}: {
  comment: ReviewComment;
  mine: boolean;
  run: boolean;
  onRewrite: (body: string) => void;
}) {
  const agent = AGENT_AUTHORS.has(comment.author);
  // 書き直しは自分の書き込みだけ。相手の言葉を書き換えられるようにはしない。
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  // 書き直しの途中で、書いたものの姿を確かめている間。
  const [see, setSee] = useState(false);
  // 入力欄は autoFocus で出し直すので、戻す先の世話は要らない。
  const flip = () => setSee((v) => !v);
  const md = useMarkdownKeys(setText, flip);
  const changed = text.trim().length > 0 && text.trim() !== comment.body;
  const save = () => {
    setEditing(false);
    if (changed) onRewrite(text.trim());
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
      return;
    }
    md.onKeyDown(e);
  };
  const startEditing = () => {
    setText(comment.body);
    setSee(false);
    setEditing(true);
  };
  return (
    // やり取りは上から順に読む平らな並び。吹き出しで左右に振ると、狭い欄では
    // 長い返信ほど細く折り返して読みにくい。
    <div className={`mg-msg${run ? " is-run" : ""}`}>
      {!run && (
        <div className="mg-msg-meta">
          {agent ? (
            <Icon name="claude" size={12} className="mg-msg-face" />
          ) : null}
          {/* 使っている本人の発言は、台帳に残る名前が何であれ「you」と呼ぶ */}
          <span className="mg-msg-name">{mine ? "you" : comment.author}</span>
          <span className="mg-msg-time">{whenText(comment.created_at)}</span>
        </div>
      )}
      {editing ? (
        <div className="mg-bubble-edit">
          {see ? (
            <CommentPreview body={text} onKeyDown={onKey} />
          ) : (
            <AutoTextarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyUp={md.onKeyUp}
              onCompositionStart={md.onCompositionStart}
              onCompositionEnd={md.onCompositionEnd}
              onKeyDown={onKey}
              minRows={2}
              maxRows={12}
              className="mg-bubble-input"
            />
          )}
          {/* 押した瞬間に確定する（mousedown で拾う）。click を待つと、
              入力欄から焦点が外れる拍子に押下がどこにも届かないことがある。
              書き換えていないときの保存は、何も書かずに閉じるだけにする。
              押せないボタンにすると、反応しないのと区別が付かない。 */}
          <div className="mg-bubble-edit-foot">
            <PreviewToggle on={see} onToggle={flip} />
            <span className="mg-side-hint">⌘Enter で保存</span>
            <button
              type="button"
              className="mg-small"
              onMouseDown={(e) => {
                e.preventDefault();
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="mg-small is-go"
              onMouseDown={(e) => {
                e.preventDefault();
                save();
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="mg-bubble">
          <CommentBody body={comment.body} />
          {mine && (
            <button
              type="button"
              title="書き直す"
              className="mg-bubble-pen"
              onClick={startEditing}
            >
              <Icon name="edit" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
