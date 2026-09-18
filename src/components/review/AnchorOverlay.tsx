import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { AnchorHit } from "../../lib/review";
import type { Mark, Marked, Rect } from "../../lib/reviewMarks";
import { useMarkdownKeys } from "../../hooks/useMarkdownKeys";
import { useLayerHost } from "../../lib/layerHost";
import { AutoTextarea } from "../AutoTextarea";
import { Icon } from "../Icon";
import { CommentBody, CommentPreview, PreviewToggle } from "./CommentMarkdown";

// 指摘が付いている箇所に印を重ねる。DOM は書き換えず、矩形を絶対配置で
// 載せるだけなので本文の組版に影響しない。
//
// 矩形をどう組むかは画面ごとに違う（読むときは目印のブロックから、編集面は
// 編集モデルの位置から）。それは measure に任せ、ここは出し方だけを持つ。
// 測り直す合図・当たり判定・ホバーのカードを 1 か所にまとめて、どちらの
// 画面でも同じ見た目・同じ操作にする。

// 印を離れてからカードを閉じるまでの猶予。印とカードの間を指が渡れる長さ。
const HOVER_GRACE = 160;

// カードと印の間、カードと画面の端の間に置く余白。
const PEEK_GAP = 6;
const PEEK_EDGE = 8;

// 本文を縦にスクロールしている枠。カードを見える範囲に収めるために使う。
function viewportOf(el: HTMLElement): { top: number; bottom: number } {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") {
      const rc = node.getBoundingClientRect();
      return { top: rc.top, bottom: rc.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

// 重ねた矩形の中に居るか。位置は重ねる先の左上からの座標で持っている。
function inside(rc: Rect, x: number, y: number): boolean {
  return (
    x >= rc.left &&
    x <= rc.left + rc.width &&
    y >= rc.top &&
    y <= rc.top + rc.height
  );
}

// 指摘が付いてからの経過。細かい数字は要らないので桁が分かる粒度で出す。
function ago(at: number): string {
  const min = (Date.now() - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  const day = Math.floor(min / 60 / 24);
  return day < 30 ? `${day} 日前` : `${Math.floor(day / 30)} か月前`;
}

export function AnchorOverlay({
  content,
  contentKey,
  measure,
  onPick,
  active,
  peek: peeking = true,
  onEdit,
  onRemove,
  onResolve,
}: {
  // 矩形を重ねる先。測る基準もこれで、印はこの中へ入れる。
  content: HTMLElement | null;
  // これが変わったら測り直す。ファイルの切り替えを拾う。
  contentKey: string;
  // 何をどこに出すか。重ねる先の矩形を渡すので、返す矩形はその左上を原点にする。
  measure: (base: DOMRect) => Marked;
  onPick: (hit: AnchorHit) => void;
  // 横の欄から選ばれている指摘。ホバーと同じ印を付けたままにして、
  // どこへの指摘かを目で探し直さずに済ませる。
  active?: string | null;
  // ホバーで中身の小窓を出すか。横の欄に同じ中身が出ているあいだは偽にする。
  // 同じことを 2 か所で言うと、どちらを読めばいいのか決まらない。
  peek?: boolean;
  // 自分の書き込みを、カードの上でそのまま書き直す。
  onEdit: (thread: string, comment: string, body: string) => void;
  // 指摘そのものを取り消す。付け間違いを本文の上から消せるようにする。
  onRemove: (id: string) => void;
  // 解決にする。レビュー画面まで行かずに片付けられるようにする。
  onResolve: (id: string) => void;
}) {
  // 重ねる先。本文の入れ物そのものへ portal すると、ファイルを切り替えて消える
  // ときに「親が先、層が後」の順になって片付けが空振りする（useLayerHost の
  // 説明）。入れ物を自分で作れば、React が持つのは中身だけになる。
  const layerHost = useLayerHost(content);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pending, setPending] = useState<Rect[]>([]);
  // 丸ごとの対象は囲みで、範囲は文字の上のマーカーで示す。
  const [pendingWhole, setPendingWhole] = useState(false);
  // ホバーで出す指摘の中身。開くまでもなく読めるようにする。
  const [peek, setPeek] = useState<{
    id: string;
    // 印の下端（既定の出し先）と上端（上に逃がすときの基準）。
    top: number;
    markTop: number;
    left: number;
    note: string;
    more: number;
    state: string;
    who: string;
    at: number;
    answered: boolean;
    comment: string;
    mine: boolean;
    hit: AnchorHit;
  } | null>(null);
  // 印からカードへ指を移す間、少しだけ開いたままにする。印を離れた瞬間に
  // 消すと、カードに触れないので押せない。
  const hideTimer = useRef<number | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 当たり判定と開き直しの判断を、描画のたびに作り直さずに済ませる控え。
  const marksRef = useRef<Mark[]>([]);
  const peekRef = useRef<string | null>(null);
  // カードの上で書き直している相手。書いている間はホバーで閉じない。
  const [edit, setEdit] = useState<{ thread: string; comment: string } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [see, setSee] = useState(false);
  // ホバーの見張りは張り替えずに済ませたいので、控えから読む。
  const editRef = useRef(false);
  editRef.current = edit !== null;
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), []);
  const hideSoon = useCallback(() => {
    if (editRef.current) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setPeek(null), HOVER_GRACE);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const stopEdit = useCallback(() => {
    setEdit(null);
    setSee(false);
    setPeek(null);
  }, []);

  // 印に何を出すか。矩形は位置を決めるためだけに受け取る。
  const showPeek = useCallback((mark: Mark, rc: Rect) => {
    peekRef.current = mark.id;
    setPeek({
      id: mark.id,
      top: rc.top + rc.height,
      markTop: rc.top,
      left: rc.left,
      note: mark.note,
      more: mark.more,
      who: mark.who,
      at: mark.at,
      answered: mark.answered,
      comment: mark.comment,
      mine: mark.mine,
      hit: mark.hit,
      state: mark.guess
        ? "元の箇所が見つかりません。近いブロックに出しています"
        : mark.moved
          ? "コメントのあと本文が書き換わっています"
          : "",
    });
  }, []);

  // 印は本文の上に重ねた飾りで、押せる箱にはしない（箱にすると、その上から
  // 文字を選べず、クリックもすべて指摘へ吸われる）。ホバーは重ねた矩形との
  // 当たり判定で見る。
  const hitAt = useCallback(
    (x: number, y: number): { mark: Mark; rc: Rect } | null => {
      for (const mark of marksRef.current) {
        // 箇所の印を先に見る。ブロック全体の枠より内側にあり、そちらの方が
        // どの指摘か絞れている。
        for (const rc of mark.spots) if (inside(rc, x, y)) return { mark, rc };
      }
      for (const mark of marksRef.current) {
        for (const rc of mark.areas) if (inside(rc, x, y)) return { mark, rc };
      }
      return null;
    },
    [],
  );

  // 出し方が切り替わったら、開いたままのものは畳む。
  useEffect(() => {
    if (!peeking) setPeek(null);
  }, [peeking]);

  // 小窓を出さないときの入口。印は押せる箱ではないので、本文への押下から
  // 当たり判定で拾う。押した指摘は横の欄で開く。
  useEffect(() => {
    if (!content || peeking) return;
    const onClick = (e: MouseEvent) => {
      const base = content.getBoundingClientRect();
      const found = hitAt(e.clientX - base.left, e.clientY - base.top);
      if (found) onPick(found.mark.hit);
    };
    content.addEventListener("click", onClick);
    return () => content.removeEventListener("click", onClick);
  }, [content, peeking, hitAt, onPick]);

  useEffect(() => {
    if (!content || !peeking) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      // 書き直している間は動かさない。別の指摘へ移ると、書いていたものが
      // 消えたように見える。
      if (editRef.current) {
        keep();
        return;
      }
      // カードの上ではカードの都合を優先する（触れているあいだは閉じない）。
      // 押しながらでも同じ。押した拍子に閉じると、その押下が本文へ抜けて
      // 選択が始まり、カードが消えたようにしか見えない。
      if ((e.target as Element | null)?.closest?.(".mg-review-peek")) {
        keep();
        return;
      }
      // 選択を引いているあいだは出さない。カードが下に出ると、ドラッグの
      // 行き先をそれが奪って選択が飛ぶ。
      if (e.buttons !== 0) {
        keep();
        if (peekRef.current) setPeek(null);
        return;
      }
      const x = e.clientX;
      const y = e.clientY;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const base = content.getBoundingClientRect();
        const found = hitAt(x - base.left, y - base.top);
        if (!found) {
          if (peekRef.current) hideSoon();
          return;
        }
        keep();
        if (peekRef.current !== found.mark.id) showPeek(found.mark, found.rc);
      });
    };
    const onLeave = () => hideSoon();
    content.addEventListener("mousemove", onMove);
    content.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      content.removeEventListener("mousemove", onMove);
      content.removeEventListener("mouseleave", onLeave);
    };
  }, [content, peeking, hitAt, keep, hideSoon, showPeek]);

  // 外を押したら書き直しをやめる。カードは触っていないと閉じる作りなので、
  // 書いている間の逃げ道をここで用意する。
  useEffect(() => {
    if (!edit) return;
    const onDown = (e: MouseEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) stopEdit();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [edit, stopEdit]);

  const compute = useCallback(() => {
    if (!content) {
      setMarks([]);
      setPending([]);
      return;
    }
    // 指摘が 1 件も無くても、書いている最中の印は出す。
    const next = measure(content.getBoundingClientRect());
    setMarks(next.marks);
    setPending(next.pending);
    setPendingWhole(!!next.pendingWhole);
  }, [content, measure]);

  // 漸進描画で後から出るブロックにも追従する。
  useLayoutEffect(() => {
    compute();
    if (!content) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(content);
    const mo = new MutationObserver(schedule);
    mo.observe(content, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    // 表やコードは枠の中で横にスクロールする。印は重ねているだけなので、
    // 枠が動いたら測り直す。scroll は上がって来ないが、捕まえる向き
    // （capture）なら親でも受け取れる。
    content.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      content.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [compute, content, contentKey]);

  // カードは既定で印の下に出す。そこが見えていないときだけ上へ逃がし、
  // 上も入らなければ見える下端ぎりぎりに置く。下に出したまま画面外へ
  // 追い出すと、読むためにいちばん下までスクロールすることになる。
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !peek || !content) return;
    const place = () => {
      card.style.top = `${peek.top + PEEK_GAP}px`;
      // 幅は一定なので、右端で切れる分だけ左へ寄せる。
      card.style.left = `${Math.max(0, Math.min(peek.left, content.clientWidth - card.offsetWidth))}px`;
      const view = viewportOf(content);
      const box = card.getBoundingClientRect();
      if (box.bottom <= view.bottom - PEEK_EDGE) return;
      const base = content.getBoundingClientRect().top;
      const above = peek.markTop - box.height - PEEK_GAP;
      card.style.top =
        base + above >= view.top + PEEK_EDGE
          ? `${above}px`
          : `${view.bottom - PEEK_EDGE - box.height - base}px`;
    };
    place();
    // 書き直しの入力欄は打つほど伸びる。高さが変わったら置き直す。
    const ro = new ResizeObserver(place);
    ro.observe(card);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [peek, content]);

  const flip = useCallback(() => setSee((v) => !v), []);
  const md = useMarkdownKeys(setDraft, flip);

  const startEdit = () => {
    if (!peek) return;
    setEdit({ thread: peek.hit.id, comment: peek.comment });
    setDraft(peek.note);
    setSee(false);
  };

  const save = () => {
    const body = draft.trim();
    const target = edit;
    const was = peek?.note ?? "";
    stopEdit();
    if (target && body && body !== was) onEdit(target.thread, target.comment, body);
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopEdit();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
      return;
    }
    md.onKeyDown(e);
  };

  marksRef.current = marks;
  if (peekRef.current !== (peek?.id ?? null)) peekRef.current = peek?.id ?? null;

  if (!content || !layerHost || (marks.length === 0 && pending.length === 0)) return null;

  return createPortal(
    <div className="mg-review-layer not-prose">
      {pending.map((rc, i) => (
        <div
          key={`d:${i}`}
          className={
            pendingWhole ? "mg-review-draft mg-review-draft-area" : "mg-review-draft"
          }
          style={rc}
        />
      ))}
      {marks.map((mark) => {
        const hot =
          peek?.id === mark.id || active === mark.id
            ? " mg-review-mark-active"
            : "";
        return (
          <Fragment key={mark.id}>
            {mark.areas.map((rc, i) => (
              <div
                key={`a:${i}`}
                className={`mg-review-mark mg-review-mark-area${
                  mark.moved ? " mg-review-mark-moved" : ""
                }${hot}`}
                style={rc}
              />
            ))}
            {mark.spots.map((rc, i) => (
              <div
                key={i}
                className={`mg-review-mark${
                  mark.moved ? " mg-review-mark-stale" : ""
                }${hot}`}
                style={rc}
              />
            ))}
          </Fragment>
        );
      })}
      {peek && (
        <div
          ref={cardRef}
          className={`mg-review-peek${edit ? " is-editing" : ""}`}
          role={edit ? undefined : "button"}
          tabIndex={edit ? -1 : 0}
          style={{ top: peek.top + PEEK_GAP, left: peek.left }}
          onMouseEnter={keep}
          onMouseLeave={hideSoon}
          // 押した瞬間に入る。click を待つと、その間に本文の選択が始まって
          // カードが閉じ、押下がどこにも届かない。
          //
          // 人の言葉は書き換えられないので、そちらは一覧で開く。
          onMouseDown={(e) => {
            // 書いている間は素通し（入力欄が焦点とキャレットを取る）。
            if (edit) return;
            // リンクと札は自分の仕事を持っている。
            if ((e.target as HTMLElement).closest("a, button")) return;
            // 本文の選択を始めさせない。
            e.preventDefault();
            if (peek.mine) startEdit();
            else onPick(peek.hit);
          }}
          onKeyDown={(e) => {
            if (edit || e.key !== "Enter") return;
            if (peek.mine) startEdit();
            else onPick(peek.hit);
          }}
        >
          <div className="mg-peek-top">
            <span className="mg-peek-face">
              <Icon name="format_quote" size={12} fill />
            </span>
            <span className="mg-peek-who">{peek.who || "コメント"}</span>
            {peek.at > 0 && <span className="mg-peek-when">{ago(peek.at)}</span>}
            {/* 一覧へ行く道は札にする。カードそのものは書き直しに使う。 */}
            <button
              type="button"
              className="mg-peek-open"
              title="コメントの一覧で開く"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPick(peek.hit);
              }}
            >
              <Icon name="open_in_new" size={13} />
            </button>
          </div>
          {edit ? (
            see ? (
              <CommentPreview body={draft} onKeyDown={onEditKey} />
            ) : (
              <AutoTextarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyUp={md.onKeyUp}
                onCompositionStart={md.onCompositionStart}
                onCompositionEnd={md.onCompositionEnd}
                onKeyDown={onEditKey}
                minRows={2}
                maxRows={8}
                className="mg-field"
              />
            )
          ) : peek.note ? (
            <CommentBody body={peek.note} className="mg-review-peek-body" />
          ) : (
            <div className="mg-review-peek-body">（本文なし）</div>
          )}
          {/* 箇所の状態は長い一言になる。操作の並びに混ぜると折り返して
              ボタンの列が崩れるので、自分の行に置く。 */}
          {!edit && peek.state && (
            <p className="mg-peek-note">
              <Icon name="history" size={11} className="mt-px shrink-0" />
              {peek.state}
            </p>
          )}
          {edit ? (
            <div className="mg-peek-edit-foot">
              <PreviewToggle on={see} onToggle={flip} />
              <span className="mg-side-hint">⌘Enter で保存</span>
              {/* 押した瞬間に確定する。click を待つと、入力欄から焦点が
                  外れる拍子に押下がどこにも届かないことがある。 */}
              <button
                type="button"
                className="mg-small"
                onMouseDown={(e) => {
                  e.preventDefault();
                  stopEdit();
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
          ) : (
          <div className="mg-peek-foot">
            {peek.answered && (
              <span className="mg-peek-chip is-answered">
                <Icon name="auto_awesome" size={11} fill />
                返信あり
              </span>
            )}
            {peek.more > 0 && (
              <span className="mg-peek-chip">
                <Icon name="forum" size={11} />
                {peek.more}
              </span>
            )}
            <span className="mg-peek-go">
              {peek.mine ? "クリックで書き直す" : "クリックで開く"}
            </span>
            {/* 解決と取り消しはカードの中から。カード自体を押すと書き直しに
                入るので、ここでは伝播を止める。 */}
            <button
              type="button"
              className="mg-peek-done"
              title="このコメントを解決にする"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPeek(null);
                onResolve(peek.hit.id);
              }}
            >
              <Icon name="check" size={13} />
            </button>
            <button
              type="button"
              className="mg-peek-drop"
              title="このコメントを削除"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPeek(null);
                onRemove(peek.hit.id);
              }}
            >
              <Icon name="delete" size={13} />
            </button>
          </div>
          )}
        </div>
      )}
    </div>,
    layerHost,
  );
}
