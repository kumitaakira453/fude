import type { MarkType } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import {
  blockKindOf,
  clearLink,
  linkAt,
  markedWith,
  setLink,
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

const INLINE: { mark: MarkType; icon: string; label: string; keys: string }[] = [
  { mark: schema.marks.strong, icon: "format_bold", label: "太字", keys: "⌘B" },
  { mark: schema.marks.em, icon: "format_italic", label: "斜体", keys: "⌘I" },
  {
    mark: schema.marks.strike,
    icon: "format_strikethrough",
    label: "取り消し線",
    keys: "⌘⇧X",
  },
  { mark: schema.marks.code, icon: "code", label: "行内コード", keys: "⌘⇧C" },
];

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
  const [link, setLinking] = useState<string | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
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
    setLinking(linkAt(view.state) ?? "");
  }, [linkNonce, view]);

  useEffect(() => {
    if (link !== null) linkRef.current?.focus();
  }, [link]);

  const kind = blockKindOf(view.state);
  const href = linkAt(view.state);
  void seq;

  const items: MenuItem[] = SLASH_ITEMS.map((item) => ({
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

  return (
    <>
      <div
        style={{ top: at.bottom + 6, left: at.left }}
        className="mg-sel-menu mg-sel-bar"
      >
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
        {INLINE.map((one) => (
          <button
            key={one.label}
            type="button"
            title={`${one.label}（${one.keys}）`}
            className={markedWith(view.state, one.mark) ? "is-on" : undefined}
            onMouseDown={run((v) => toggleInline(one.mark)(v.state, v.dispatch, v))}
          >
            <Icon name={one.icon} size={15} />
          </button>
        ))}
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
            setLinking("");
          }}
        >
          <Icon name="link" size={15} />
        </button>
        <span className="mg-sel-menu-sep" />
        <button type="button" onMouseDown={run(() => onComment(), { keep: false })}>
          <Icon name="add_comment" size={14} />
          コメント
        </button>
      </div>

      {link !== null && (
        // 行き先を聞く。帯の下に出し、Enter で張る。
        <div
          style={{ top: at.bottom + 42, left: at.left }}
          className="mg-sel-menu mg-sel-link"
        >
          <input
            ref={linkRef}
            value={link}
            placeholder="https://…"
            spellCheck={false}
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setLinking(null);
                view.focus();
                return;
              }
              if (e.key !== "Enter") return;
              e.preventDefault();
              const url = link.trim();
              setLinking(null);
              if (url) setLink(url)(view.state, view.dispatch, view);
              view.focus();
              bump();
            }}
          />
        </div>
      )}

      {menu && (
        <BlockMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
