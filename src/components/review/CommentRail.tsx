import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMarkdownKeys } from "../../hooks/useMarkdownKeys";
import { headOf, type Resolution } from "../../lib/blockDiff";
import type { ReviewComment, ReviewThread } from "../../lib/review";
import { ago } from "../../lib/when";
import { AutoTextarea } from "../AutoTextarea";
import { Icon } from "../Icon";
import { CommentBody } from "./CommentMarkdown";

// 本文の横に出すコメント。目次と同じ場所を取り合う（どちらも右の欄）。
//
// 札は指摘したブロックの高さに置き、本文と一緒に流す。上から順に積むと、本文を
// 送ったときに札だけが取り残されて、どの札がどこの話なのか分からなくなる。
// 重なりそうなら下へ押し下げる——本文の順は保たれるので、読む向きは変わらない。

// 札と札のあいだ。
const GAP = 8;
// 引用に出す長さ。札の背丈を揃えるためで、続きは一覧で読める。
const QUOTE_LIMIT = 80;
// 答える側の顔。エージェントには機械らしい印を出す。
const AGENTS = new Set(["AI", "ai", "assistant", "claude"]);

function oneLine(text: string, limit = QUOTE_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

interface Card {
  thread: ReviewThread;
  block: number;
}

export function CommentRail({
  content,
  scroller,
  threads,
  resolutions,
  loose,
  openLoose,
  onOpenLoose,
  active,
  onPick,
  onOpen,
  onResolve,
  onReply,
}: {
  // 飛び先と置き場所を引く本文。印を重ねている入れ物と同じもの。
  content: HTMLElement | null;
  // 本文を流している枠。送られたら札を置き直す。
  scroller: HTMLElement | null;
  // このファイルの未解決の指摘。
  threads: ReviewThread[];
  resolutions: Map<string, Resolution>;
  // 本文に居場所を持たない指摘。流れる列には混ぜられないので別に置く。
  loose: ReviewThread[];
  // 外れた指摘の組を開いているか。ツールバーの札からも開けるよう、外で持つ。
  openLoose: boolean;
  onOpenLoose: (open: boolean) => void;
  active: string | null;
  onPick: (id: string) => void;
  onOpen: (id: string) => void;
  onResolve: (id: string) => void;
  onReply: (id: string, body: string) => void;
}) {
  // 本文の並び順に出す。台帳の並びは書いた順なので、そのままでは本文を
  // 行ったり来たりすることになる。
  //
  // 今の本文に居場所を持たない指摘はここへ入れない。押しても飛ぶ先が無い。
  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    for (const thread of threads) {
      const head = headOf(resolutions.get(thread.id) ?? { state: "unknown", index: -1 });
      if (head) out.push({ thread, block: head.index });
    }
    return out.sort((a, b) => a.block - b.block);
  }, [threads, resolutions]);

  const railRef = useRef<HTMLElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);

  // 札を、指摘したブロックの高さへ置く。背丈は描き終わってからでないと測れない
  // ので、状態には持たず DOM へ直に書く（状態に持つと測る→描く→また測るで
  // 回り続ける）。
  const place = useCallback(() => {
    const flow = flowRef.current;
    const rail = railRef.current;
    if (!flow || !rail || !content) return;
    const top0 = rail.getBoundingClientRect().top;
    let prev = -Infinity;
    for (const el of Array.from(flow.children) as HTMLElement[]) {
      const block = el.dataset.mgFor;
      const at = block ? content.querySelector(`[data-mg-block="${block}"]`) : null;
      if (!at) {
        // 漸進描画でまだ出ていないブロック。場所が決まらないうちは隠す。
        el.style.visibility = "hidden";
        continue;
      }
      const want = at.getBoundingClientRect().top - top0;
      const top = Math.max(want, prev + GAP);
      el.style.visibility = "";
      el.style.top = `${top}px`;
      prev = top + el.offsetHeight;
    }
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
    // 札の背丈は返信を開いたときにも変わる。中身と枠の両方を見張る。
    const ro = new ResizeObserver(schedule);
    for (const el of Array.from(flow.children)) ro.observe(el);
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
  }, [place, content, scroller, cards, openLoose]);

  // 札を押したら、その箇所を選ぶ。札は箇所の真横に居るので、見えている
  // ものへ送り直さない（押しただけで本文が動くと、読んでいた場所を失う）。
  const jump = (card: Card) => {
    onPick(card.thread.id);
    const at = content?.querySelector(`[data-mg-block="${card.block}"]`);
    if (!at) return;
    const box = at.getBoundingClientRect();
    const view = (scroller ?? railRef.current)?.getBoundingClientRect();
    if (view && box.top >= view.top && box.bottom <= view.bottom) return;
    at.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <nav
      ref={railRef}
      className="mg-rail relative hidden min-h-0 w-72 shrink-0 self-stretch overflow-hidden border-l border-[var(--mg-border)] lg:block"
    >
      {loose.length > 0 && (
        <div className="mg-rail-loose">
          <button
            type="button"
            onClick={() => onOpenLoose(!openLoose)}
            className="mg-rail-loose-top"
          >
            <Icon name="link_off" size={14} />
            本文から外れたコメント {loose.length} 件
            <Icon name={openLoose ? "expand_less" : "expand_more"} size={16} />
          </button>
          {openLoose &&
            loose.map((thread) => (
              <RailCard
                key={thread.id}
                thread={thread}
                on={active === thread.id}
                stray
                onJump={() => onPick(thread.id)}
                onOpen={() => onOpen(thread.id)}
                onResolve={() => onResolve(thread.id)}
                onReply={(body) => onReply(thread.id, body)}
              />
            ))}
        </div>
      )}

      <div ref={flowRef} className="mg-rail-flow">
        {cards.map((card) => (
          <RailCard
            key={card.thread.id}
            thread={card.thread}
            block={card.block}
            on={active === card.thread.id}
            onJump={() => jump(card)}
            onOpen={() => onOpen(card.thread.id)}
            onResolve={() => onResolve(card.thread.id)}
            onReply={(body) => onReply(card.thread.id, body)}
          />
        ))}
      </div>

      {cards.length === 0 && loose.length === 0 && (
        <p className="mg-rail-none">このファイルに未解決のコメントはありません。</p>
      )}
    </nav>
  );
}

function RailCard({
  thread,
  block,
  on,
  stray,
  onJump,
  onOpen,
  onResolve,
  onReply,
}: {
  thread: ReviewThread;
  // 流れる列に置くときの行き先。外れた指摘は持たない。
  block?: number;
  on: boolean;
  stray?: boolean;
  onJump: () => void;
  onOpen: () => void;
  onResolve: () => void;
  onReply: (body: string) => void;
}) {
  const quote = oneLine(thread.selection || thread.quote);
  const [writing, setWriting] = useState(false);
  return (
    // 中に Markdown のリンクと入力欄が入るので、札そのものは button にしない
    // （押せるものの入れ子になる）。押下の伝播は中の釦の側で止める。
    <div
      role="button"
      tabIndex={0}
      data-mg-for={block}
      onClick={onJump}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onJump();
        }
      }}
      className={`mg-rail-card${on ? " is-on" : ""}${stray ? " is-stray" : ""}`}
    >
      {quote && <div className="mg-rail-quote">{quote}</div>}
      {stray && <div className="mg-rail-stray">本文から外れています</div>}
      {thread.comments.map((c) => (
        <Said key={c.id} comment={c} />
      ))}
      {writing ? (
        <Reply
          onSend={(body) => {
            setWriting(false);
            onReply(body);
          }}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <div className="mg-rail-foot">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setWriting(true);
            }}
            className="mg-rail-reply-open"
          >
            返信…
          </button>
          <RailAct icon="done" label="解決にする" onPick={onResolve} />
          <RailAct icon="open_in_full" label="一覧で開く" onPick={onOpen} />
        </div>
      )}
    </div>
  );
}

function Said({ comment }: { comment: ReviewComment }) {
  const agent = AGENTS.has(comment.author);
  return (
    <div className="mg-rail-said">
      <div className="mg-rail-who">
        <span className="mg-rail-face">
          <Icon name={agent ? "auto_awesome" : "person"} size={11} fill />
        </span>
        <span className="mg-rail-name">{comment.author}</span>
        <span>{ago(comment.created_at)}</span>
      </div>
      <CommentBody body={comment.body} className="mg-rail-body" />
    </div>
  );
}

function Reply({
  onSend,
  onCancel,
}: {
  onSend: (body: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const md = useMarkdownKeys(setText);
  const send = () => {
    const body = text.trim();
    if (body) onSend(body);
    else onCancel();
  };
  return (
    <div className="mg-rail-reply" onClick={(e) => e.stopPropagation()}>
      <AutoTextarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyUp={md.onKeyUp}
        onCompositionStart={md.onCompositionStart}
        onCompositionEnd={md.onCompositionEnd}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            send();
            return;
          }
          md.onKeyDown(e);
        }}
        placeholder="返信を書く…（⌘Enter で送る）"
        minRows={2}
        maxRows={8}
      />
      <div className="mg-rail-foot">
        <button type="button" onClick={onCancel} className="mg-rail-reply-off">
          やめる
        </button>
        <button type="button" onClick={send} className="mg-rail-reply-send">
          返信
        </button>
      </div>
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
