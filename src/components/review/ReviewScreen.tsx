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
  type SpotState,
} from "../../lib/spotDiff";
import { copyText } from "../../lib/clip";
import { fontStack } from "../../lib/fonts";
import { answerOf } from "../../lib/versions";
import { REVIEW_SIDE_WIDTH, fitReviewSideWidth } from "../../lib/sidebar";
import { buildProjection } from "../../lib/projection";
import { inEditable } from "../../lib/ui";
import { parseFrontmatter } from "../../lib/frontmatter";
import {
  isOpen,
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
  activeFolderIdAtom,
  reviewSideWidthAtom,
  contentCacheAtom,
  editorialAtom,
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

// 一覧の見出しに出す名前と場所。絶対パスを丸ごと 1 行に流すと 4 行に折り返して
// 一覧そのものが読めなくなるので、ファイル名と「その手前の 2 階層」に分ける。
// 全体は title で読める。
const DIR_TAIL = 2;

function fileLabel(root: string | null, file: string): { name: string; dir: string } {
  const path = pathLabel(root, file);
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

// フロントマターの行数。本文の頭がファイルの何行目から始まるかを出す。
function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
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
  const all = useMemo(() => ledger.threads.filter(isOpen), [ledger]);
  const inFolder = useMemo(
    () =>
      root === null
        ? all
        : all.filter((t) => relativeTo(root, t.file) !== null),
    [all, root],
  );
  const elsewhere = all.length - inFolder.length;
  // 解決にすると押した瞬間から一覧に出さない。台帳への書き込みと読み直しは
  // 背後で進むので、それを待ってから消すと、押しても何も起きない間ができる。
  // しくじったら戻す（台帳が変わらなければ、下げていた分がそのまま戻る）。
  const [going, setGoing] = useState<ReadonlySet<string>>(() => new Set());
  const goingRef = useRef(going);
  goingRef.current = going;
  const threads = useMemo(
    () => (going.size === 0 ? inFolder : inFolder.filter((t) => !going.has(t.id))),
    [inFolder, going],
  );
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
  const shown = useMemo(
    () => (pending ? null : pick(shownId ?? null)),
    [pending, pick, shownId],
  );
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
      try {
        if (!(await resolveThread(id, REVIEW_AUTHOR))) return;
        await syncLedger(store);
        const restore = async () => {
          setReviewUndo(null);
          if (!(await reopenThread(id))) return;
          setSelectedId(id);
          await syncLedger(store);
          notify(store, "未解決に戻しました");
        };
        setReviewUndo(restore);
        notify(store, "解決にしました", "center", {
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
      const text = reviewPrompt(pathLabel(root, file), list, (t) =>
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
    [root, store],
  );

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
        const rel = relativeTo(root, file);
        const raw = rel === null ? undefined : cacheRef.current.get(rel);
        if (raw !== undefined) {
          const { body } = parseFrontmatter(raw);
          // 本文がファイルの何行目から始まるか（フロントマターの行数）。
          const shift = countLines(raw.slice(0, raw.length - body.length));
          const blocks = splitBlocks(body);
          for (const t of list) {
            // 版の本文は id で覚えているので、2 度目からは取りに行かない。
            const base = await readVersion(t.base_version);
            if (!alive) return;
            found.set(t.id, factsOf(t, pathLabel(root, file), blocks, body, shift, base));
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
              : "このフォルダに未解決のコメントはありません"}
            {elsewhere > 0 && (
              <span className="ml-1.5 text-[11px] text-[var(--mg-muted)]">
                他のフォルダに {elsewhere} 件
              </span>
            )}
          </div>
        </div>
        <span className="flex-1" />
        <button
          onClick={() => setScreen(false)}
          className="flex items-center gap-1 rounded-lg border border-[var(--mg-border)] px-2.5 py-1 text-[12px] text-[var(--mg-fg-dim)] transition duration-100 active:scale-95 hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="close" size={15} />
          閉じる
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-[19rem] shrink-0 overflow-y-auto border-r border-[var(--mg-border)] bg-[var(--mg-panel)]">
          {groups.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-[var(--mg-muted)]">
              {elsewhere > 0
                ? "このフォルダには未解決のコメントがありません。他のフォルダのコメントは、そのフォルダを開くと出ます。"
                : "コメントが付くとここに並びます。"}
            </p>
          )}
          {groups.map(([file, list]) => {
            const where = fileLabel(root, file);
            return (
              <section key={file} className="mg-review-set">
                <h2 className="mg-review-group">
                  <Icon name="description" size={14} className="mg-review-ico" />
                  <span className="mg-review-place" title={file}>
                    <span className="mg-review-name">{where.name}</span>
                    {where.dir && <span className="mg-review-dir">{where.dir}</span>}
                  </span>
                  <span className="mg-count">{list.length}</span>
                  <button
                    onClick={() => copyPrompt(file, list)}
                    title="このファイルのコメントを AI 用のプロンプトとして写す"
                    className="mg-bulk"
                  >
                    <Icon
                      name={copiedFile === file ? "check" : "content_copy"}
                      size={14}
                    />
                  </button>
                  <button
                    onClick={() => void resolveFile(file, list)}
                    disabled={bulkFile !== null}
                    title="このファイルのコメントをすべて解決にする"
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
                      factsById.get(thread.id)?.where ??
                      thread.section_path.join(" › ")
                    }
                    state={factsById.get(thread.id)?.spot.state}
                    active={thread.id === selected?.id}
                    onPick={() => setSelectedId(thread.id)}
                    onResolve={() => void resolveOne(thread.id)}
                  />
                ))}
              </section>
            );
          })}
        </nav>

        {threads.length === 0 ? (
          <p className="p-8 text-[13px] text-[var(--mg-muted)]">
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
              key={shown.id}
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
      <aside className="mg-side" style={{ width: sideWidth }}>
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

// 一覧に出す「何への指摘か」の 1 行。記法をそのまま出すと
// `| **バージョン** | **更新日** |` のような並びになって読めないので、
// 画面に出るときの字へ均してから 1 行に詰める。
const lineCache = new Map<string, string>();

// 一覧に出す指摘の 1 行。ここは 2 行の枠なので組版はせず、記法だけを落として
// 字の並びに均す（`**強調**` の記号が本文として読まれないようにする）。
const bodyCache = new Map<string, string>();

function bodyLine(body: string): string {
  const hit = bodyCache.get(body);
  if (hit !== undefined) return hit;
  const plain = buildProjection(body).plain.replace(/\s+/g, " ").trim();
  const line = plain || body.replace(/\s+/g, " ").trim();
  bodyCache.set(body, line);
  return line;
}

function targetLine(thread: ReviewThread): string {
  const raw = thread.selection.trim();
  if (raw) return raw.replace(/\s+/g, " ");
  const hit = lineCache.get(thread.quote);
  if (hit !== undefined) return hit;
  const plain = buildProjection(thread.quote).plain.replace(/\s+/g, " ").trim();
  const line = plain || thread.quote.replace(/\s+/g, " ").trim();
  lineCache.set(thread.quote, line);
  return line;
}

export function ThreadCard({
  thread,
  where,
  state,
  active,
  onPick,
  onResolve,
}: {
  thread: ReviewThread;
  where: string;
  // 指摘の箇所が今どうなっているか。突き合わせが済むまでは無い。
  state?: SpotState;
  active: boolean;
  onPick: () => void;
  onResolve: () => void;
}) {
  return (
    // 釦の中に釦は置けないので、札そのものは div で受ける（押す・Enter・Space
    // は自分で見る）。解決の釦は押した先を分ける。
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onPick();
      }}
      className={`mg-thread-card ${active ? "is-active" : ""}`}
    >
      {/* 読みたいのは指摘そのもの。対象はその下に、手がかりとして小さく添える。 */}
      <div className="mg-thread-body">
        {bodyLine(thread.comments[0]?.body ?? "") || "（本文なし）"}
      </div>
      <div className={`mg-thread-quote${state ? " has-state" : ""}`}>
        {state && (
          <span className={`mg-thread-state is-${state}`} title={SPOT_NAME[state]}>
            <Icon name={SPOT_ICON[state]} size={11} fill />
          </span>
        )}
        <span>{targetLine(thread)}</span>
      </div>
      <div className="mg-thread-foot">
        {/* 幅が狭いので、いちばん細かい節だけを出す。全体は title で読める。
            見出しを辿り終える前は何も出さない（後から入る） */}
        <span className="mg-thread-where" title={where}>
          {where.split(" › ").pop()}
        </span>
        <span className="mg-thread-when" title={whenText(thread.created_at)}>
          {ago(thread.created_at)}
        </span>
        {answeredByAgent(thread) && (
          <span className="mg-thread-answered" title="AI からの返信が届いています">
            <Icon name="auto_awesome" size={11} fill />
            返信
          </span>
        )}
        {thread.comments.length > 1 && (
          <span className="mg-thread-count">
            <Icon name="forum" size={11} />
            {thread.comments.length}
          </span>
        )}
        {/* 解決は手がかりの列の端に置く。指摘の字に重ねると読めなくなる。 */}
        <button
          type="button"
          title="解決にする（⌘⇧D）"
          className="mg-thread-done"
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
        >
          <Icon name="check" size={13} />
        </button>
      </div>
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
  const root = useAtomValue(activeFolderIdAtom);
  const editorial = useAtomValue(editorialAtom);
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

  const rel = useMemo(() => relativeTo(root, thread.file), [root, thread.file]);
  const where = useMemo(() => fileLabel(root, thread.file), [root, thread.file]);

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

  const view = useMemo(() => {
    if (currentBody === null) return null;
    const blocks = splitBlocks(currentBody);
    const spot = spotDiff(thread, blocks, baseText);
    // 指摘の箇所の外で動いた所。コメントへの対応は、指摘された塊の外で
    // 行われることがある。
    const changes =
      baseText === null
        ? []
        : changesSince(baseText, blocks).filter((c) => c.index !== spot.index);
    const crumbs =
      spot.state === "unknown"
        ? thread.section_path
        : sectionPathAt(blocks, Math.min(spot.index, blocks.length - 1));
    return { blocks, spot, changes, crumbs };
  }, [baseText, currentBody, thread]);

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
  const [goTo, setGoTo] = useState<{ at: number; nonce: number } | null>(null);
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
  const jump = () => setFocus((n) => n + 1);
  // 会話を左右に振る。指摘を出した人（＝最初に発言した人）を右に置く。
  const reviewer =
    thread.comments.find((c) => !AGENT_AUTHORS.has(c.author))?.author ?? REVIEW_AUTHOR;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div ref={setPaper} className="mx-auto max-w-3xl px-6 py-6">
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
                editorial={editorial}
                style={style}
                focusNonce={focus}
                selection={thread.selection}
                onSettled={settle}
              />
            </markdownContext.Provider>
          )}
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
          <span className="mg-review-place flex-1" title={thread.file}>
            <span className="mg-review-name">{where.name}</span>
            {where.dir && <span className="mg-review-dir">{where.dir}</span>}
          </span>
          <button
            onClick={jump}
            disabled={!hasTarget}
            title={
              hasTarget
                ? "本文のコメントの箇所へ戻る"
                : "コメントの箇所が今の本文のどこかを決められていません"
            }
            className="mg-side-open"
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
            <button onClick={nextChange} className="mg-side-next">
              次の変更へ
            </button>
          </div>
        )}
        {view && <SpotCard spot={view.spot} />}

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
            <span className="mg-side-hint">⌘Enter で送信</span>
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
            className="mg-act is-done"
          >
            <Icon
              name={resolving ? "progress_activity" : "check_circle"}
              size={15}
              fill={!resolving}
              className={resolving ? "mg-spin" : undefined}
            />
            {resolving ? "解決にしています…" : "解決にする"}
          </button>
          <span className="flex-1" />
          <button
            onClick={() => void drop()}
            disabled={removing}
            title="コメントそのものを取り消す（解決の記録は残らない）"
            className="mg-act is-drop"
          >
            <Icon
              name={removing ? "progress_activity" : "delete"}
              size={14}
              className={removing ? "mg-spin" : undefined}
            />
            削除
          </button>
        </div>
      </aside>
    </div>
  );
}

// 指摘の箇所が今どうなっているか。返信を書く前にいちばん見たいものなので、
// 会話のすぐ下、書き込む欄の手前に置く。
//
// 色だけでは状態を言い分けられない（テーマによって danger とアクセントが
// 同系色になる）。記号と語を必ず添える。
function SpotCard({ spot }: { spot: SpotDiff }) {
  const moved = spot.added > 0 || spot.removed > 0;
  return (
    <div className={`mg-spot-card is-${spot.state}`}>
      <div className="mg-spot-card-head">
        <Icon name={SPOT_ICON[spot.state]} size={13} fill />
        {SPOT_NAME[spot.state]}
        {moved && (
          <span className="mg-spot-delta">
            {spot.added > 0 && <span className="is-add">＋{spot.added}</span>}
            {spot.removed > 0 && <span className="is-del">−{spot.removed}</span>}
          </span>
        )}
      </div>
      <p>{spotNote(spot)}</p>
    </div>
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
  // 吹き出しの幅。書き直しに入った瞬間に横幅が変わると、同じ発言が別の形に
  // 見えてしまうので、入る直前の幅をそのまま引き継ぐ。
  const [width, setWidth] = useState<number | undefined>(undefined);
  const bubbleRef = useRef<HTMLDivElement>(null);
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
    setWidth(bubbleRef.current?.getBoundingClientRect().width);
    setText(comment.body);
    setSee(false);
    setEditing(true);
  };
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
            <span>{whenText(comment.created_at)}</span>
          </div>
        )}
        {editing ? (
          <div className="mg-bubble-edit" style={{ width }}>
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
          <div className="mg-bubble" ref={bubbleRef}>
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
    </div>
  );
}
