import type { MarkType } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { placeNear, roomOf, seenIn } from "../lib/floatAt";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  blockKindOf,
  clearLink,
  clearMarks,
  inCell,
  linkAt,
  markedWith,
  mathAt,
  setLink,
  setMath,
  toggleInline,
} from "../lib/md/marks";
import { openMath } from "../lib/md/math";
import { schema } from "../lib/md/schema";
import { SLASH_ITEMS } from "../lib/md/slash";
import { AskBox } from "./AskBox";
import { BlockMenu, MENU_WIDTH, type MenuItem } from "./BlockMenu";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

// 選んだ文字に対する操作。選択の下に帯で出す。
//
// 装飾は打鍵（⌘B など）でも付くが、既に書いた文を選んで直すときに打鍵を
// 覚えている必要はない。ブロックの種別を変えるのもスラッシュコマンドは
// 「段落の先頭で / を打つ」入口しか無く、書き終えた文からは辿れなかった。
//
// 押しても選択が消えないようにするのが肝。click を待つと押した時点で
// ブラウザが選択を解き、この帯自身が消えて mouseup がどこにも届かない。
// mousedown で処理し、preventDefault で選択の解除も止める（読むとき側の
// 小メニューと同じ理由）。
//
// 並べ方は縦積み。種別とコメントはそれぞれ 1 段を丸ごと使い、装飾は 4 つずつ
// 2 段に割る。横に長いと本文を覆う幅が広く、押す先も探しにくい。

// 装飾の段。4 つずつで割る。
const MARKS: { mark: MarkType; icon: string; label: string; keys: string }[] = [
  { mark: schema.marks.strong, icon: "format_bold", label: "太字", keys: "⌘B" },
  { mark: schema.marks.em, icon: "format_italic", label: "斜体", keys: "⌘I" },
  {
    mark: schema.marks.underline,
    icon: "format_underlined",
    label: "下線",
    keys: "⌘U",
  },
];

const MORE: { mark: MarkType; icon: string; label: string; keys: string }[] = [
  {
    mark: schema.marks.strike,
    icon: "format_strikethrough",
    label: "取り消し線",
    keys: "⌘⇧X",
  },
  { mark: schema.marks.code, icon: "code", label: "行内コード", keys: "⌘⇧C" },
];

// 聞くもの（いまはリンクの行き先だけ）。出す場所は開いたときに測る。
//
// 式は聞かずにその場で作る。打つそばから組み直すのは節点の側が持っている。
interface Asking {
  text: string;
  at: { left: number; top: number };
}

export function SelectionBar({
  view,
  at,
  span,
  linkNonce,
  pin = 0,
  within,
  onComment,
}: {
  view: EditorView;
  // 帯を出す位置。選択の下端の左。ビューポート座標。
  at: { top: number; bottom: number; left: number };
  // 出している選択。位置を出し直すかどうかの判断に使う。
  span: { from: number; to: number };
  // ⌘K が押された合図。増えたらリンクの入力を開く。
  linkNonce: number;
  // 本文を送った合図。増えたら置き場所を取り直す。
  pin?: number;
  // 本文が見えている枠。渡されなければ画面ぜんたい。
  within?: HTMLElement | null;
  onComment: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const seen = useRef(linkNonce);

  // 聞く小窓を出す場所。帯の左下に置く。
  const under = (): { left: number; top: number } => {
    const from = panel.current?.getBoundingClientRect();
    return from
      ? { left: from.left, top: from.bottom + 8 }
      : { left: box.left, top: box.bottom + 8 };
  };

  // 出す場所は、選んでいるところが変わるまで動かさない。
  //
  // 装飾を付けると字幅が変わって選択の矩形も動く。そのたびに帯が跳ねると、
  // 続けて別のボタンを押せない。本文を送った分（pin）は通す。送った先へ
  // 付いていかないと、選んだところと離れて見える。
  const spot = useRef(at);
  const held = useRef(`${span.from},${span.to},${pin}`);
  const now = `${span.from},${span.to},${pin}`;
  if (held.current !== now) {
    held.current = now;
    spot.current = at;
  }
  const box = spot.current;


  // 押した分をその場で見た目へ返す。編集モデルの選択は transaction のたびに
  // 変わるので、描き直しの合図として控えを持つ。
  const [seq, setSeq] = useState(0);
  const bump = () => setSeq((n) => n + 1);

  // 自分の大きさを測って、入る側へ置く。下に余地が無ければ上へ回す。
  // 測る前の 1 枚は下に置く（多くの場合そこで足りる）。
  const [place, setPlace] = useState<{ top: number; left: number }>({
    top: box.bottom + 8,
    left: box.left,
  });
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const fit = () => {
      const size = el.getBoundingClientRect();
      // 縦は止めない。選んだところが本文の外へ流れたら、帯も一緒に出ていく。
      setPlace(placeNear(box, size, roomOf(within), false));
    };
    fit();
    // 中身は開閉で高さが変わる（リンクの入力・ブロックの一覧）。
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [box, seq, menu, asking, within]);

  const run =
    (
      apply: (v: EditorView) => void,
      opts: { keep?: boolean } = { keep: true },
    ) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      apply(view);
      // 続けて別の装飾を付けられるように焦点と選択は戻す。
      if (opts.keep !== false) view.focus();
      bump();
    };

  useEffect(() => {
    if (linkNonce === seen.current) return;
    seen.current = linkNonce;
    setAsking({ text: linkAt(view.state) ?? "", at: under() });
    // under は描き終わった帯を測るだけなので、ここに入れると出す場所が
    // 毎回の描き直しで動く。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkNonce, view]);

  const kind = blockKindOf(view.state);
  // 表のセルの中では種別を出さない。セルは行内しか持てないので、見出しにも
  // 箇条書きにも変えられない。
  const cell = inCell(view.state);
  const href = linkAt(view.state);
  const tex = mathAt(view.state);
  void seq;

  const items: MenuItem[] = SLASH_ITEMS.filter((item) => !item.inserts).map(
    (item) => ({
      icon: item.icon,
      label: item.label,
      keys: item.hint || undefined,
      on: item.id === kind?.id,
      run: () => {
        item.run(view.state, view.dispatch, view);
        view.focus();
        setMenu(null);
        bump();
      },
    }),
  );

  const toggle = (one: {
    mark: MarkType;
    icon: string;
    label: string;
    keys: string;
  }) => (
    <Tooltip
      key={one.label}
      label={one.label}
      keys={one.keys}
      side="right"
      tone="dark"
    >
      <button
        type="button"
        aria-label={one.label}
        className={markedWith(view.state, one.mark) ? "is-on" : undefined}
        onMouseDown={run((v) => toggleInline(one.mark)(v.state, v.dispatch, v))}
      >
        <Icon name={one.icon} size={16} />
      </button>
    </Tooltip>
  );

  // 聞いた行き先を当てる。空なら何もせず閉じる。
  const settle = (asked: Asking) => {
    const text = asked.text.trim();
    setAsking(null);
    if (text) setLink(text)(view.state, view.dispatch, view);
    view.focus();
    bump();
  };

  // 選んだところが本文の枠から外れたら出さない。送り戻せばまた出る。
  if (!seenIn(box, roomOf(within))) return null;

  return (
    <>
      <div
        ref={panel}
        style={{ top: place.top, left: place.left }}
        className="mg-sel-menu mg-sel-bar"
      >
        {!cell && (
          <Tooltip label="ブロックの種別を変える" side="top" tone="dark">
            <button
              type="button"
              aria-label="ブロックの種別"
              className="mg-sel-line"
              // 出すのは click。mousedown で出すと、メニューが付ける
              // 「外を押したら閉じる」（mousedown を見ている）が、まだ
              // 配り終えていないその押下を受け取って端から閉じてしまう。
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                // 出す先は帯の横。上下だと帯そのものか本文に重なる。
                const from = panel.current?.getBoundingClientRect();
                if (!from) return;
                const right = from.right + 6;
                setMenu({
                  x:
                    right + MENU_WIDTH <= window.innerWidth
                      ? right
                      : from.left - 6 - MENU_WIDTH,
                  y: from.top,
                });
              }}
            >
              <Icon name={kind?.icon ?? "text_fields"} size={16} />
              <span className="mg-sel-name">{kind?.label ?? "テキスト"}</span>
              <Icon name="chevron_right" size={16} className="mg-sel-more" />
            </button>
          </Tooltip>
        )}

        <div className="mg-sel-row">
          {MARKS.map(toggle)}
          <Tooltip label="書式をクリア" side="right" tone="dark">
            <button
              type="button"
              aria-label="書式をクリア"
              onMouseDown={run((v) => clearMarks(v.state, v.dispatch, v))}
            >
              <Icon name="format_clear" size={16} />
            </button>
          </Tooltip>
        </div>

        <div className="mg-sel-row">
          <Tooltip
            label={href === null ? "リンクにする" : "リンクを外す"}
            keys={href === null ? "⌘K" : undefined}
            side="right"
            tone="dark"
          >
            <button
              type="button"
              aria-label="リンク"
              className={href === null ? undefined : "is-on"}
              onMouseDown={(e) => {
                e.preventDefault();
                if (href !== null) {
                  clearLink(view.state, view.dispatch, view);
                  view.focus();
                  bump();
                  return;
                }
                setAsking({ text: "", at: under() });
              }}
            >
              <Icon name="link" size={16} />
            </button>
          </Tooltip>
          {MORE.map(toggle)}
          <Tooltip
            label={tex === null ? "式にする" : "式を打ち直す"}
            side="right"
            tone="dark"
          >
            <button
              type="button"
              aria-label="式"
              className={tex === null ? undefined : "is-on"}
              onMouseDown={(e) => {
                e.preventDefault();
                // その場で式にして、あとは節点の打ち直しに任せる。打つそばから
                // 組み直すのは節点の側が持っているので、入口を分けない。
                const body = view.state.doc.textBetween(span.from, span.to);
                if (tex === null && !body.trim()) return;
                if (tex === null) setMath(body)(view.state, view.dispatch, view);
                openMath(view, span.from);
                bump();
              }}
            >
              <Icon name="functions" size={16} />
            </button>
          </Tooltip>
        </div>

        <Tooltip
          label="選んだところにコメントを付ける"
          side="bottom"
          tone="dark"
        >
          <button
            type="button"
            aria-label="コメント"
            className="mg-sel-line"
            onMouseDown={run(() => onComment(), { keep: false })}
          >
            <Icon name="add_comment" size={16} />
            <span className="mg-sel-name">コメント</span>
          </button>
        </Tooltip>
      </div>

      {asking && (
        <AskBox
          hint="https://…"
          label="リンクの行き先"
          text={asking.text}
          at={asking.at}
          onText={(text) => setAsking({ ...asking, text })}
          onDone={() => settle(asking)}
          onClose={() => {
            setAsking(null);
            view.focus();
          }}
        />
      )}

      {menu && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
