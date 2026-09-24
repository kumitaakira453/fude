import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMarkdownKeys } from "../../hooks/useMarkdownKeys";
import { headOf, type Resolution } from "../../lib/blockDiff";
import {
  hasReply,
  isOpen,
  RAIL_FILTERS,
  type RailFilter,
  type ReviewComment,
  type ReviewThread,
} from "../../lib/review";
import { ago } from "../../lib/when";
import { AutoTextarea } from "../AutoTextarea";
import { Icon } from "../Icon";
import { CommentBody } from "./CommentMarkdown";

// 本文の横に出すコメント。目次と同じ場所を取り合う（どちらも右の欄）。
//
// 札は指摘したブロックの高さに置き、本文と一緒に流す。上から順に積むと、本文を
// 送ったときに札だけが取り残されて、どの札がどこの話なのか分からなくなる。
// 重なりそうなら下へ押し下げる——本文の順は保たれるので、読む向きは変わらない。
//
// 札は最初から会話を出し切る。畳んでおくと、読むたびに開く操作が挟まるだけで、
// 出てくるのは結局同じものになる。押した札だけ色を変えるのもやめ、どれの話かは
// 本文が動くことと、本文の印が濃くなることで示す。

// 札と札のあいだ。
const GAP = 8;
// 引用に出す長さ。
const QUOTE_LIMIT = 80;
// 答える側の顔。エージェントには機械らしい印を出す。
const AGENTS = new Set(["AI", "ai", "assistant", "claude"]);

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

interface Card {
  thread: ReviewThread;
  block: number;
  done: boolean;
}

// 絞り込みの札。押すと選択肢が開き、それぞれの件数が並ぶ。
//
// 帯（タブ）で分けていた頃は「面の切り替え」に見えて、いま何で絞っているのか
// が読み取れなかった。選んでいるものだけを札に出し、他は開いたときに見せる。
function FilterChip({
  now,
  counts,
  onPick,
}: {
  now: RailFilter;
  counts: Record<RailFilter, number>;
  onPick: (filter: RailFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const here = RAIL_FILTERS.find((f) => f.id === now) ?? RAIL_FILTERS[0];
  // 片付いた割合。押す前に、どれだけ進んだかがひと目で分かる。
  const share = counts.all === 0 ? 0 : counts.done / counts.all;

  return (
    <div ref={box} className="mg-rail-filter">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`mg-rail-chip${open ? " is-open" : ""}`}
      >
        <i className={`mg-rail-dot is-${here.id}`} />
        {here.name}
        <b>{counts[now]}</b>
        <Icon name={open ? "expand_less" : "expand_more"} size={14} />
      </button>
      {open && (
        <div className="mg-rail-menu">
          {RAIL_FILTERS.map((one) => (
            <button
              key={one.id}
              type="button"
              onClick={() => {
                onPick(one.id);
                setOpen(false);
              }}
              className={`mg-rail-opt${one.id === now ? " is-on" : ""}${
                counts[one.id] === 0 ? " is-empty" : ""
              }`}
            >
              <i className={`mg-rail-dot is-${one.id}`} />
              <span className="mg-rail-opt-name">
                {one.name}
                {one.note && <em>{one.note}</em>}
              </span>
              <b>{counts[one.id]}</b>
            </button>
          ))}
          {/* 片付いた割合。全部片付くと満ちる。 */}
          <div className="mg-rail-gauge" title={`${counts.done} / ${counts.all} 片付いた`}>
            <i style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function CommentRail({
  railRef,
  content,
  scroller,
  threads,
  done,
  resolutions,
  loose,
  filter,
  onFilter,
  width,
  active,
  onPick,
  onShow,
  onOpen,
  onResolve,
  onReopen,
  onReply,
}: {
  // 欄そのもの。掴んで幅を変えるとき、仕切りがここへ直に書く。
  railRef: React.MutableRefObject<HTMLElement | null>;
  // 飛び先と置き場所を引く本文。印を重ねている入れ物と同じもの。
  content: HTMLElement | null;
  // 本文を流している枠。送られたら札を置き直す。
  scroller: HTMLElement | null;
  // このファイルの未解決の指摘。
  threads: ReviewThread[];
  // 片付いた指摘。絞り込みを「すべて」にしたときだけ列へ混ぜる。
  done: ReviewThread[];
  resolutions: Map<string, Resolution>;
  // 本文に居場所を持たない指摘。流れる列には混ぜられないので別に置く。
  loose: ReviewThread[];
  // 何を出すか。片付いたものを引くかどうかが変わるので、呼ぶ側が持つ。
  filter: RailFilter;
  onFilter: (filter: RailFilter) => void;
  // 欄の幅。掴んで変えた分を呼ぶ側が覚える。
  width: number;
  // 選んでいる 1 枚。本文の印と同じ合図を使う。
  active: string | null;
  onPick: (id: string | null) => void;
  // その指摘の箇所まで本文を送る。読む面と編集面で引き方が違うので呼ぶ側に任せる。
  onShow: (id: string, block: number) => void;
  onOpen: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen: (id: string) => void;
  onReply: (id: string, body: string) => void;
}) {
  // 本文の並び順に出す。台帳の並びは書いた順なので、そのままでは本文を
  // 行ったり来たりすることになる。
  //
  // 今の本文に居場所を持たない指摘はここへ入れない。押しても飛ぶ先が無い。
  // 絞り込みごとの件数。選ぶ前に、どれがどれだけあるかを見せる。
  const counts = useMemo(() => {
    const todo = [...threads, ...loose].filter((t) => !hasReply(t)).length;
    const open = threads.length + loose.length;
    return { todo, open, done: done.length, all: open + done.length };
  }, [threads, loose, done]);

  const keep = useCallback(
    (thread: ReviewThread, settled: boolean) => {
      if (filter === "all") return true;
      if (filter === "done") return settled;
      if (settled) return false;
      return filter === "open" || !hasReply(thread);
    },
    [filter],
  );

  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    for (const thread of [...threads, ...done]) {
      if (!keep(thread, !isOpen(thread))) continue;
      const head = headOf(
        resolutions.get(thread.id) ?? { state: "unknown", index: -1 },
      );
      if (head) out.push({ thread, block: head.index, done: !isOpen(thread) });
    }
    return out.sort((a, b) => a.block - b.block);
  }, [keep, threads, done, resolutions]);

  // 本文から外れた指摘も同じ絞り込みに従う。
  const strays = useMemo(
    () => loose.filter((thread) => keep(thread, false)),
    [keep, loose],
  );

  const flowRef = useRef<HTMLDivElement | null>(null);
  // 本文から外れた指摘の組。欄の中だけの開け閉めなので、ここで持つ。
  const [openLoose, setOpenLoose] = useState(false);

  // 札を、指摘したブロックの高さへ置く。背丈は描き終わってからでないと測れない
  // ので、状態には持たず DOM へ直に書く（状態に持つと測る→描く→また測るで
  // 回り続ける）。
  const place = useCallback(() => {
    const flow = flowRef.current;
    const rail = railRef.current;
    if (!flow || !rail || !content) return;
    const box = rail.getBoundingClientRect();
    // 欄が出ていないあいだ（狭い画面・分割中）は測れない。出たら欄そのものの
    // 大きさが変わって呼び直されるので、ここでは何も書かない。
    if (box.height === 0) return;
    const top0 = box.top;
    const els = Array.from(flow.children) as HTMLElement[];
    // まず行き先を測る。漸進描画でまだ出ていないブロックの札は隠す。
    const tops = els.map((el) => {
      const block = el.dataset.mgFor;
      const at = block ? content.querySelector(`[data-mg-block="${block}"]`) : null;
      if (!at) {
        el.style.visibility = "hidden";
        return null;
      }
      el.style.visibility = "";
      return at.getBoundingClientRect().top - top0;
    });

    // 選んでいる札は、その箇所の真横に据える。全部を一律に下へ押し下げると、
    // 上に何枚か溜まっているだけで、選んだ札が箇所からずり落ちる。
    const pin = els.findIndex((el, i) => el.dataset.mgOn === "1" && tops[i] !== null);
    let prev = pin < 0 ? -Infinity : tops[pin]! + els[pin].offsetHeight;
    for (let i = pin + 1; i < els.length; i++) {
      if (tops[i] === null) continue;
      tops[i] = Math.max(tops[i]!, prev + GAP);
      prev = tops[i]! + els[i].offsetHeight;
    }
    // 選んだ札より上は、そこへぶつからないよう上へ逃がす。
    if (pin >= 0) {
      let next = tops[pin]!;
      for (let i = pin - 1; i >= 0; i--) {
        if (tops[i] === null) continue;
        tops[i] = Math.min(tops[i]!, next - els[i].offsetHeight - GAP);
        next = tops[i]!;
      }
    }
    els.forEach((el, i) => {
      if (tops[i] !== null) el.style.top = `${tops[i]}px`;
    });
  }, [content]);

  useLayoutEffect(() => {
    place();
    const flow = flowRef.current;
    if (!flow) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    // 札の背丈は開いたときにも返信を書くときにも変わる。中身と枠の両方を見張る。
    const ro = new ResizeObserver(schedule);
    for (const el of Array.from(flow.children)) ro.observe(el);
    if (railRef.current) ro.observe(railRef.current);
    if (content) ro.observe(content);
    const mo = content ? new MutationObserver(schedule) : null;
    mo?.observe(content!, { childList: true, subtree: true });
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo?.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [place, content, scroller, cards, openLoose, active]);

  // 積んでいるとき（編集中）は、選ばれた札を欄の見えるところへ寄せる。流れる
  // 列では札が箇所の真横に居るので要らない。
  useEffect(() => {
    if (content || !active) return;
    flowRef.current
      ?.querySelector('[data-mg-on="1"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [content, active]);

  // 札の外を押したら選びを外す。返信の口は選ばれた札にだけ出るので、これが
  // 無いと開きっぱなしになる。押下の段で外すので、本文の印を押したときは
  // そのあとの click で選び直される。
  useEffect(() => {
    if (!active) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".mg-rail-card")) onPick(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [active, onPick]);

  // 札を押したら、その箇所を選んで本文をそこへ送る。札は箇所の真横に居るので、
  // 送った先でも札はついてくる。
  const jump = (card: Card) => {
    onPick(card.thread.id);
    onShow(card.thread.id, card.block);
  };


  return (
    <nav
      ref={(el) => {
        railRef.current = el;
      }}
      onKeyDown={(e) => {
        // 開いた札を畳む。欄の中だけの取り決めにして、全体のキー操作には触らない。
        if (e.key === "Escape" && active) {
          e.stopPropagation();
          onPick(null);
        }
      }}
      style={{ width }}
      className={`mg-rail relative hidden min-h-0 shrink-0 self-stretch lg:block${
        content ? "" : " is-static"
      }`}
    >
      <div className="mg-rail-bar">
        <FilterChip now={filter} counts={counts} onPick={onFilter} />
        {strays.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenLoose(!openLoose)}
            title="本文から外れたコメント"
            className={`mg-rail-stray-top${openLoose ? " is-on" : ""}`}
          >
            <Icon name="link_off" size={13} />
            {strays.length}
            <Icon name={openLoose ? "expand_less" : "expand_more"} size={14} />
          </button>
        )}
      </div>

      {openLoose && strays.length > 0 && (
        <div className="mg-rail-loose">
          {strays.map((thread) => (
            <RailCard
              key={thread.id}
              thread={thread}
              active={active === thread.id}
              stray
              onJump={() => onPick(thread.id)}
              onOpen={() => onOpen(thread.id)}
              onResolve={() => onResolve(thread.id)}
              onReopen={() => onReopen(thread.id)}
              onReply={(text) => onReply(thread.id, text)}
            />
          ))}
        </div>
      )}

      {/* 本文を引けないとき（編集面は目印を持たない）は、絶対配置をやめて
          上から積む。行き先が決まらないまま絶対配置にすると、札がぜんぶ
          同じ場所へ重なる。 */}
      <div
        ref={flowRef}
        className={`mg-rail-flow${content ? "" : " is-static"}`}
      >
        {cards.map((card) => (
          <RailCard
            key={card.thread.id}
            thread={card.thread}
            block={card.block}
            done={card.done}
            active={active === card.thread.id}
            onJump={() => jump(card)}
            onOpen={() => onOpen(card.thread.id)}
            onResolve={() => onResolve(card.thread.id)}
            onReopen={() => onReopen(card.thread.id)}
            onReply={(text) => onReply(card.thread.id, text)}
          />
        ))}
      </div>

      {cards.length === 0 && strays.length === 0 && (
        <p className="mg-rail-none">
          {counts.all === 0
            ? "コメントはありません。"
            : filter === "todo"
              ? "未対応のコメントはありません。片付いています。"
              : `${RAIL_FILTERS.find((f) => f.id === filter)?.name}のコメントはありません。`}
        </p>
      )}
    </nav>
  );
}

function RailCard({
  thread,
  block,
  stray,
  done,
  active,
  onJump,
  onOpen,
  onResolve,
  onReopen,
  onReply,
}: {
  thread: ReviewThread;
  // 流れる列に置くときの行き先。外れた指摘は持たない。
  block?: number;
  stray?: boolean;
  // 片付いた指摘。字を落として、解決の釦は取り消しに替える。
  done?: boolean;
  // 選ばれている札。返信の口はここにだけ出す。
  active: boolean;
  onJump: () => void;
  onOpen: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onReply: (body: string) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // 返信の口を開いているか。選ばれていること（＝本文の印と対になっていること）
  // とは別に持つ。本文の印を押しただけで書く構えに入られると、読んでいる途中に
  // 入力欄が割り込む。
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const md = useMarkdownKeys(setText);
  // 焦点を当てると既定でその要素が見える位置まで送られ、直前に始めた本文の
  // 滑らかな送りを打ち消す。当てるだけにする。
  useEffect(() => {
    if (writing) box.current?.focus({ preventScroll: true });
  }, [writing]);

  // 選びが自分から外れたら口を閉じる。書きかけがあるうちは残す。
  useEffect(() => {
    if (!active && !text.trim()) setWriting(false);
  }, [active, text]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    onReply(body);
  };

  return (
    // 中に Markdown のリンクと入力欄が入るので、札そのものは button にしない
    // （押せるものの入れ子になる）。押下の伝播は中の釦の側で止める。
    <div
      data-mg-for={block}
      data-mg-on={active ? "1" : undefined}
      // 押したら箇所へ送り、そのまま書き始められるところまで運ぶ。釦を挟むと、
      // 読んだ流れが一度切れる。
      onClick={() => {
        onJump();
        setWriting(true);
        box.current?.focus({ preventScroll: true });
      }}
      className={`mg-rail-card${active ? " is-on" : ""}${stray ? " is-stray" : ""}${
        done ? " is-done" : ""
      }`}
    >
      {/* 札の始末。入力欄の有無で場所が動かないよう、右上へ寄せて重ねる。 */}
      <div className="mg-rail-acts">
        {done ? (
          <RailAct icon="undo" label="未解決に戻す" onPick={onReopen} />
        ) : (
          <RailAct icon="done" label="解決にする" onPick={onResolve} />
        )}
        <RailAct icon="open_in_new" label="別の画面で開く" onPick={onOpen} />
      </div>
      <div className="mg-rail-quote">
        {oneLine(thread.selection || thread.quote, QUOTE_LIMIT)}
      </div>
      {stray && (
        <div className="mg-rail-note">
          <Icon name="link_off" size={12} />
          本文から外れています
        </div>
      )}
      {done && (
        <div className="mg-rail-note">
          <Icon name="done" size={12} />
          解決済み
        </div>
      )}
      <div className="mg-rail-talk">
        {thread.comments.map((c) => (
          <Said key={c.id} comment={c} />
        ))}
      </div>
      {/* 返信の口は押した札にだけ。書きかけがあるうちは、選びが外れても残す。 */}
      {(writing || text.trim()) && (
        // 入力欄を押したときまで箇所へ送ると、打っている最中に本文が動く。
        <div className="mg-rail-reply" onClick={(e) => e.stopPropagation()}>
          <AutoTextarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyUp={md.onKeyUp}
            onCompositionStart={md.onCompositionStart}
            onCompositionEnd={md.onCompositionEnd}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setText("");
                box.current?.blur();
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
                return;
              }
              md.onKeyDown(e);
            }}
            placeholder="返信…"
            minRows={1}
            maxRows={8}
          />
          {text.trim() && (
            <div className="mg-rail-send">
              <button
                type="button"
                onClick={() => setText("")}
                className="mg-rail-reply-off"
              >
                やめる
              </button>
              <button type="button" onClick={send} className="mg-rail-reply-send">
                返信
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Face({ author }: { author: string }) {
  const agent = AGENTS.has(author);
  return (
    <span className={`mg-rail-face${agent ? " is-agent" : ""}`}>
      <Icon name={agent ? "auto_awesome" : "person"} size={11} fill />
    </span>
  );
}

function Said({ comment }: { comment: ReviewComment }) {
  return (
    <div className="mg-rail-said">
      <div className="mg-rail-who">
        <Face author={comment.author} />
        <span className="mg-rail-name">{comment.author}</span>
        <span>{ago(comment.created_at)}</span>
      </div>
      <CommentBody body={comment.body} className="mg-rail-body" />
    </div>
  );
}

function RailAct({
  icon,
  label,
  onPick,
}: {
  icon: string;
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      className="mg-rail-act"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}
