import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMarkdownKeys } from "../../hooks/useMarkdownKeys";
import { headOf, type Resolution } from "../../lib/blockDiff";
import { answeredByAgent, type ReviewComment, type ReviewThread } from "../../lib/review";
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
// 開くのは選んでいる 1 枚だけ。全部を開いたまま並べると、指摘が 3 件あるだけで
// 欄が埋まり、いま見ている 1 件がどれなのか分からなくなる。畳んだ札は「そこに
// 何かある」ことだけを伝える。

// 札と札のあいだ。
const GAP = 8;
// 畳んだ姿に出す一言の長さ。狭い桁なので切って、続きは開いてから読ませる。
const PEEK_LIMIT = 44;
// 引用に出す長さ。
const QUOTE_LIMIT = 80;
// 答える側の顔。エージェントには機械らしい印を出す。
const AGENTS = new Set(["AI", "ai", "assistant", "claude"]);

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// 畳んだ姿に出す一言。組版はしないので、記法の印だけ落として字にする。
function plainish(body: string, limit = PEEK_LIMIT): string {
  const bare = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}[#>|]+\s*/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_`~]/g, "");
  return oneLine(bare, limit);
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
  // 開いている 1 枚。本文の印と同じ合図を使う。
  active: string | null;
  onPick: (id: string | null) => void;
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
    const box = rail.getBoundingClientRect();
    // 欄が出ていないあいだ（狭い画面・分割中）は測れない。出たら欄そのものの
    // 大きさが変わって呼び直されるので、ここでは何も書かない。
    if (box.height === 0) return;
    const top0 = box.top;
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

  const total = cards.length + loose.length;

  return (
    <nav
      ref={railRef}
      onKeyDown={(e) => {
        // 開いた札を畳む。欄の中だけの取り決めにして、全体のキー操作には触らない。
        if (e.key === "Escape" && active) {
          e.stopPropagation();
          onPick(null);
        }
      }}
      className={`mg-rail relative hidden min-h-0 w-72 shrink-0 self-stretch border-l border-[var(--mg-border)] lg:block${
        content ? "" : " is-static"
      }`}
    >
      <div className="mg-rail-bar">
        <span className="mg-rail-count">
          {total > 0 ? `未解決 ${total}` : "コメントはありません"}
        </span>
        {loose.length > 0 && (
          <button
            type="button"
            onClick={() => onOpenLoose(!openLoose)}
            title="本文から外れたコメント"
            className={`mg-rail-stray-top${openLoose ? " is-on" : ""}`}
          >
            <Icon name="link_off" size={13} />
            {loose.length}
            <Icon name={openLoose ? "expand_less" : "expand_more"} size={14} />
          </button>
        )}
      </div>

      {openLoose && loose.length > 0 && (
        <div className="mg-rail-loose">
          {loose.map((thread) => (
            <RailCard
              key={thread.id}
              thread={thread}
              open={active === thread.id}
              stray
              onJump={() => onPick(thread.id)}
              onOpen={() => onOpen(thread.id)}
              onResolve={() => onResolve(thread.id)}
              onReply={(text) => onReply(thread.id, text)}
            />
          ))}
        </div>
      )}

      {/* 本文を引けないとき（編集面は目印を持たない）は、絶対配置をやめて
          上から積む。行き先が決まらないまま絶対配置にすると、札がぜんぶ
          同じ場所へ重なる。 */}
      <div ref={flowRef} className={`mg-rail-flow${content ? "" : " is-static"}`}>
        {cards.map((card) => (
          <RailCard
            key={card.thread.id}
            thread={card.thread}
            block={card.block}
            open={active === card.thread.id}
            onJump={() => jump(card)}
            onOpen={() => onOpen(card.thread.id)}
            onResolve={() => onResolve(card.thread.id)}
            onReply={(text) => onReply(card.thread.id, text)}
          />
        ))}
      </div>
    </nav>
  );
}

function RailCard({
  thread,
  block,
  open,
  stray,
  onJump,
  onOpen,
  onResolve,
  onReply,
}: {
  thread: ReviewThread;
  // 流れる列に置くときの行き先。外れた指摘は持たない。
  block?: number;
  open: boolean;
  stray?: boolean;
  onJump: () => void;
  onOpen: () => void;
  onResolve: () => void;
  onReply: (body: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const head = thread.comments[0];
  const replies = Math.max(0, thread.comments.length - 1);

  return (
    // 中に Markdown のリンクと入力欄が入るので、札そのものは button にしない
    // （押せるものの入れ子になる）。押下の伝播は中の釦の側で止める。
    <div
      role="button"
      tabIndex={0}
      data-mg-for={block}
      // 開いている札を押しても畳まない。読んでいる途中に閉じると戻す手立てが無い。
      onClick={() => !open && onJump()}
      onKeyDown={(e) => {
        if (!open && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onJump();
        }
      }}
      className={`mg-rail-card${open ? " is-open" : ""}${stray ? " is-stray" : ""}`}
    >
      {open ? (
        <>
          <div className="mg-rail-quote">
            {oneLine(thread.selection || thread.quote, QUOTE_LIMIT)}
          </div>
          {stray && (
            <div className="mg-rail-note">
              <Icon name="link_off" size={12} />
              本文から外れています
            </div>
          )}
          <div className="mg-rail-talk">
            {thread.comments.map((c) => (
              <Said key={c.id} comment={c} />
            ))}
          </div>
          {writing ? (
            <Reply
              onSend={(text) => {
                setWriting(false);
                onReply(text);
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
                返信を書く
              </button>
              <RailAct icon="done" label="解決にする" onPick={onResolve} />
              <RailAct icon="open_in_full" label="一覧で開く" onPick={onOpen} />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mg-rail-who">
            <Face author={head?.author ?? ""} />
            <span className="mg-rail-name">{head?.author}</span>
            <span>{head ? ago(head.created_at) : ""}</span>
            <span className="mg-rail-chips">
              {answeredByAgent(thread) && (
                <span className="mg-rail-chip is-answered" title="返事が届いています">
                  <Icon name="auto_awesome" size={10} fill />
                </span>
              )}
              {replies > 0 && (
                <span className="mg-rail-chip" title={`返信 ${replies} 件`}>
                  <Icon name="forum" size={10} />
                  {replies}
                </span>
              )}
            </span>
          </div>
          <div className="mg-rail-peek">{plainish(head?.body ?? "")}</div>
        </>
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
