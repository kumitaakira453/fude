import { useMemo } from "react";
import { headOf, type Resolution } from "../../lib/blockDiff";
import { type ReviewThread } from "../../lib/review";
import { ago } from "../../lib/when";
import { Icon } from "../Icon";
import { CommentBody } from "./CommentMarkdown";

// 本文の横に出すコメント。目次と同じ場所を取り合う（どちらも右の欄）。
//
// 本文に重ねる印は「どこへの指摘か」しか示せず、中身はホバーするまで読めない。
// 読み合わせのあいだは中身のほうを見ていたいので、並べて置ける場所を用意する。
// 押した指摘は本文の側でも際立たせて、欄と本文を目で往復せずに済むようにする。

// 引用に出す長さ。札の高さを揃えるためで、続きは指摘を開けば読める。
const QUOTE_LIMIT = 80;

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
  threads,
  resolutions,
  active,
  onPick,
  onOpen,
  onResolve,
}: {
  // 飛び先を引く本文。印を重ねている入れ物と同じもの。
  content: HTMLElement | null;
  // このファイルの未解決の指摘。
  threads: ReviewThread[];
  resolutions: Map<string, Resolution>;
  active: string | null;
  onPick: (id: string) => void;
  onOpen: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  // 本文の並び順に出す。台帳の並びは書いた順なので、そのままでは本文を
  // 行ったり来たりすることになる。
  //
  // 今の本文に居場所を持たない指摘は出さない。本文に印が出ないものを欄にだけ
  // 並べると、押しても飛ぶ先が無い。外れた指摘はレビュー画面で辿る。
  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    for (const thread of threads) {
      const head = headOf(resolutions.get(thread.id) ?? { state: "unknown", index: -1 });
      if (head) out.push({ thread, block: head.index });
    }
    return out.sort((a, b) => a.block - b.block);
  }, [threads, resolutions]);

  const jump = (card: Card) => {
    onPick(card.thread.id);
    content
      ?.querySelector(`[data-mg-block="${card.block}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <nav className="mg-rail hidden min-h-0 w-72 shrink-0 self-stretch overflow-y-auto border-l border-[var(--mg-border)] py-6 pl-4 pr-3 lg:block">
      <div className="mb-2 flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
        コメント
        {cards.length > 0 && <span className="normal-case">{cards.length}</span>}
      </div>
      {cards.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[var(--mg-muted)]">
          このファイルに未解決のコメントはありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <RailCard
              key={card.thread.id}
              thread={card.thread}
              on={active === card.thread.id}
              onJump={() => jump(card)}
              onOpen={() => onOpen(card.thread.id)}
              onResolve={() => onResolve(card.thread.id)}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

function RailCard({
  thread,
  on,
  onJump,
  onOpen,
  onResolve,
}: {
  thread: ReviewThread;
  on: boolean;
  onJump: () => void;
  onOpen: () => void;
  onResolve: () => void;
}) {
  const quote = oneLine(thread.selection || thread.quote);
  return (
    // 中に Markdown のリンクが入るので、札そのものは button にしない
    // （押せるものの入れ子になる）。押下の伝播は中の釦の側で止める。
    <li
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onJump();
        }
      }}
      className={`mg-rail-card${on ? " is-on" : ""}`}
    >
      {quote && <div className="mg-rail-quote">{quote}</div>}
      {thread.comments.map((c) => (
        <div key={c.id} className="mg-rail-msg">
          <div className="mg-rail-who">
            <span className="mg-rail-name">{c.author}</span>
            <span>{ago(c.created_at)}</span>
          </div>
          <CommentBody body={c.body} className="mg-rail-body" />
        </div>
      ))}
      <div className="mg-rail-acts">
        <RailAct icon="done" label="解決にする" onPick={onResolve} />
        <RailAct icon="open_in_full" label="一覧で開く" onPick={onOpen} />
      </div>
    </li>
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
