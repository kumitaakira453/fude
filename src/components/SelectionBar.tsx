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
// 項目が多いので段に分けて積む。上段はブロックそのものへの操作、下段は選んだ
// 文字への操作、行き先や式を聞く入力はさらにその下の段。

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

const HINT: Record<Asking["kind"], string> = {
  link: "https://…",
  math: "E = mc^2",
};

export function SelectionBar({
  view,
  at,
  linkNonce,
  onComment,
}: {
  view: EditorView;
  // 帯を出す位置。選択の下端の左。ビューポート座標。
  at: { top: number; bottom: number; left: number };
  // ⌘K が押された合図。増えたらリンクの入力を開く。
  linkNonce: number;
  onComment: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const seen = useRef(linkNonce);

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
    if (asking) askRef.current?.focus();
  }, [asking]);

  const kind = blockKindOf(view.state);
  // 表のセルの中では種別を出さない。セルは行内しか持てないので、見出しにも
  // 箇条書きにも変えられない。
  const cell = inCell(view.state);
  const href = linkAt(view.state);
  void seq;

  const items: MenuItem[] = SLASH_ITEMS.filter((item) => !item.inserts).map((item) => ({
    icon: item.icon,
    label: item.label,
    keys: item.hint || undefined,
    run: () => {
      item.run(view.state, view.dispatch, view);
      view.focus();
      setMenu(null);
      bump();
    },
  }));

  const toggle = (one: { mark: MarkType; icon: string; label: string; keys: string }) => (
    <button
      key={one.label}
      type="button"
      title={`${one.label}（${one.keys}）`}
      className={markedWith(view.state, one.mark) ? "is-on" : undefined}
      onMouseDown={run((v) => toggleInline(one.mark)(v.state, v.dispatch, v))}
    >
      <Icon name={one.icon} size={15} />
    </button>
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
        style={{ top: at.bottom + 6, left: at.left }}
        className="mg-sel-menu mg-sel-bar"
      >
        <div className="mg-sel-row">
          {!cell && (
            <>
              <button
                type="button"
                title="ブロックの種別を変える"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenu({ x: box.left, y: box.bottom + 4 });
                }}
              >
                <Icon name={kind?.icon ?? "text_fields"} size={14} />
                {kind?.label ?? "テキスト"}
                <Icon name="expand_more" size={14} />
              </button>
              <span className="mg-sel-menu-sep" />
            </>
          )}
          <button type="button" onMouseDown={run(() => onComment(), { keep: false })}>
            <Icon name="add_comment" size={14} />
            コメント
          </button>
        </div>

        <div className="mg-sel-row">
          {MARKS.map(toggle)}
          <button
            type="button"
            title="書式をクリア"
            onMouseDown={run((v) => clearMarks(v.state, v.dispatch, v))}
          >
            <Icon name="format_clear" size={15} />
          </button>
          <span className="mg-sel-menu-sep" />
          <button
            type="button"
            title={href === null ? "リンクにする（⌘K）" : "リンクを外す"}
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
            <Icon name="link" size={15} />
          </button>
          {MORE.map(toggle)}
          <button
            type="button"
            title="式に変換"
            className={mathAt(view.state) === null ? undefined : "is-on"}
            onMouseDown={(e) => {
              e.preventDefault();
              const { from, to } = view.state.selection;
              // 式の上を選んでいれば打ち直し、そうでなければ選んだ文字を
              // そのまま中身にする。
              setAsking({
                kind: "math",
                text: mathAt(view.state) ?? view.state.doc.textBetween(from, to),
              });
            }}
          >
            <Icon name="functions" size={15} />
          </button>
        </div>

        {asking && (
          // 帯の中に段として足す。別の箱にすると帯の高さの分だけ位置を
          // ずらす必要があり、段数を変えるたびに狂う。
          <div className="mg-sel-row mg-sel-link">
            <input
              ref={askRef}
              value={asking.text}
              placeholder={HINT[asking.kind]}
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
          </div>
        )}
      </div>

      {menu && (
        <BlockMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
