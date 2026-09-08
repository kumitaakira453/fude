import type { MarkType } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
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
import { schema } from "../lib/md/schema";
import { SLASH_ITEMS } from "../lib/md/slash";
import { BlockMenu, type MenuItem } from "./BlockMenu";
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
// 段に分けて積む。上段はブロックそのものへの操作、下段は選んだ文字への操作、
// 行き先や式を聞く入力はさらにその下の段。

// 下段の前半。書式クリアまでがひと組。
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

// 下段の後半。リンクと式は入力を伴うので、ここには並べない。
const MORE: { mark: MarkType; icon: string; label: string; keys: string }[] = [
  {
    mark: schema.marks.strike,
    icon: "format_strikethrough",
    label: "取り消し線",
    keys: "⌘⇧X",
  },
  { mark: schema.marks.code, icon: "code", label: "行内コード", keys: "⌘⇧C" },
];

// 聞くもの。行き先（リンク）か、式の中身（TeX）。
interface Asking {
  kind: "link" | "math";
  text: string;
}

const ASK: Record<Asking["kind"], { hint: string; label: string }> = {
  link: { hint: "https://…", label: "リンクの行き先" },
  math: { hint: "E = mc^2", label: "式（TeX）" },
};

export function SelectionBar({
  view,
  at,
  span,
  linkNonce,
  onComment,
}: {
  view: EditorView;
  // 帯を出す位置。選択の下端の左。ビューポート座標。
  at: { top: number; bottom: number; left: number };
  // 出している選択。位置を出し直すかどうかの判断に使う。
  span: { from: number; to: number };
  // ⌘K が押された合図。増えたらリンクの入力を開く。
  linkNonce: number;
  onComment: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const seen = useRef(linkNonce);

  // 出す場所は、選んでいるところが変わるまで動かさない。
  //
  // 装飾を付けると字幅が変わって選択の矩形も動く。そのたびに帯が跳ねると、
  // 続けて別のボタンを押せない。
  const spot = useRef(at);
  const held = useRef(`${span.from},${span.to}`);
  const now = `${span.from},${span.to}`;
  if (held.current !== now) {
    held.current = now;
    spot.current = at;
  }
  const box = spot.current;

  // 押した分をその場で見た目へ返す。編集モデルの選択は transaction のたびに
  // 変わるので、描き直しの合図として控えを持つ。
  const [seq, setSeq] = useState(0);
  const bump = () => setSeq((n) => n + 1);

  const run = (
    apply: (v: EditorView) => void,
    opts: { keep?: boolean } = { keep: true },
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    apply(view);
    // 続けて別の装飾を付けられるように焦点と選択は戻す。
    if (opts.keep !== false) view.focus();
    bump();
  };

  useEffect(() => {
    if (linkNonce === seen.current) return;
    seen.current = linkNonce;
    setAsking({ kind: "link", text: linkAt(view.state) ?? "" });
  }, [linkNonce, view]);

  useEffect(() => {
    if (asking) askRef.current?.select();
  }, [asking]);

  const kind = blockKindOf(view.state);
  // 表のセルの中では種別を出さない。セルは行内しか持てないので、見出しにも
  // 箇条書きにも変えられない。
  const cell = inCell(view.state);
  const href = linkAt(view.state);
  const tex = mathAt(view.state);
  void seq;

  const items: MenuItem[] = SLASH_ITEMS.filter((item) => !item.inserts).map((item) => ({
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
  }));

  const toggle = (one: { mark: MarkType; icon: string; label: string; keys: string }) => (
    <Tooltip key={one.label} label={one.label} keys={one.keys} tone="dark">
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

  // 聞いたものを当てる。空なら何もせず閉じる。
  const settle = (asked: Asking) => {
    const text = asked.text.trim();
    setAsking(null);
    if (text) {
      const apply = asked.kind === "link" ? setLink(text) : setMath(text);
      apply(view.state, view.dispatch, view);
    }
    view.focus();
    bump();
  };

  return (
    <>
      <div
        ref={panel}
        style={{ top: box.bottom + 8, left: box.left }}
        className="mg-sel-menu mg-sel-bar"
      >
        <div className="mg-sel-row">
          {!cell && (
            <>
              <Tooltip label="ブロックの種別を変える" tone="dark">
                <button
                  type="button"
                  aria-label="ブロックの種別"
                  className="mg-sel-wide"
                  // 出すのは click。mousedown で出すと、メニューが付ける
                  // 「外を押したら閉じる」（mousedown を見ている）が、まだ
                  // 配り終えていないその押下を受け取って端から閉じてしまう。
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    // 出す先は帯の下。ボタンの下だと帯そのものに重なる。
                    const from = e.currentTarget.getBoundingClientRect();
                    const under = panel.current?.getBoundingClientRect().bottom ?? from.bottom;
                    setMenu({ x: from.left, y: under + 6 });
                  }}
                >
                  <Icon name={kind?.icon ?? "text_fields"} size={16} />
                  <span className="mg-sel-name">{kind?.label ?? "テキスト"}</span>
                  <Icon name="expand_more" size={14} />
                </button>
              </Tooltip>
              <span className="mg-sel-menu-sep" />
            </>
          )}
          <Tooltip label="選んだところにコメントを付ける" tone="dark">
            <button
              type="button"
              aria-label="コメント"
              className="mg-sel-wide"
              onMouseDown={run(() => onComment(), { keep: false })}
            >
              <Icon name="add_comment" size={16} />
              <span className="mg-sel-name">コメント</span>
            </button>
          </Tooltip>
        </div>

        <div className="mg-sel-row">
          {MARKS.map(toggle)}
          <Tooltip label="書式をクリア" tone="dark">
            <button
              type="button"
              aria-label="書式をクリア"
              onMouseDown={run((v) => clearMarks(v.state, v.dispatch, v))}
            >
              <Icon name="format_clear" size={16} />
            </button>
          </Tooltip>
          <span className="mg-sel-menu-sep" />
          <Tooltip
            label={href === null ? "リンクにする" : "リンクを外す"}
            keys={href === null ? "⌘K" : undefined}
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
                setAsking({ kind: "link", text: "" });
              }}
            >
              <Icon name="link" size={16} />
            </button>
          </Tooltip>
          {MORE.map(toggle)}
          <Tooltip label={tex === null ? "式にする" : "式を打ち直す"} tone="dark">
            <button
              type="button"
              aria-label="式"
              className={tex === null ? undefined : "is-on"}
              onMouseDown={(e) => {
                e.preventDefault();
                // 式の上を選んでいれば打ち直し、そうでなければ選んだ文字を
                // そのまま中身にする。
                setAsking({
                  kind: "math",
                  text: tex ?? view.state.doc.textBetween(span.from, span.to),
                });
              }}
            >
              <Icon name="functions" size={16} />
            </button>
          </Tooltip>
        </div>

        {asking && (
          // 帯の中に段として足す。別の箱にすると帯の高さの分だけ位置を
          // ずらす必要があり、段数を変えるたびに狂う。
          <div className="mg-sel-row mg-sel-ask">
            <input
              ref={askRef}
              value={asking.text}
              placeholder={ASK[asking.kind].hint}
              aria-label={ASK[asking.kind].label}
              spellCheck={false}
              onChange={(e) => setAsking({ ...asking, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setAsking(null);
                  view.focus();
                  return;
                }
                if (e.key !== "Enter") return;
                e.preventDefault();
                settle(asking);
              }}
            />
            <Tooltip label="決める" keys="⏎" align="end" tone="dark">
              <button
                type="button"
                aria-label="決める"
                onMouseDown={(e) => {
                  e.preventDefault();
                  settle(asking);
                }}
              >
                <Icon name="keyboard_return" size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {menu && (
        <BlockMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
