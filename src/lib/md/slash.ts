import { chainCommands, setBlockType } from "prosemirror-commands";
import type { Attrs, NodeType, ResolvedPos } from "prosemirror-model";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type PluginView,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { icon } from "./nodeViews";
import { DETAILS_HEAD, schema } from "./schema";

// 段落の先頭で "/" を打って構造を選ぶ小窓。
//
// 記号を覚えていなくても構造を作れる道。打ち込みでの変換（inputRules）と作る
// ものは同じで、こちらは一覧から選ぶ。選んだら "/" と絞り込みの文字を消して
// から構造にするので、原文には記号が残らない。
//
// 小窓は body に置いて画面座標で貼る。編集面の中に置くと囲みの切り抜きに負ける。
// 絞り込みの文字は本文に入ったまま持つ（入力欄に持たせると、該当が無くなった
// ときに打った文字を捨てることになる）。

// ---- 候補 ----

export interface SlashItem {
  id: string;
  label: string;
  // Material Symbols の名前。
  icon: string;
  // 打ち込みでも作れる記号。無いものは空。
  hint: string;
  // 表示名では当たらない呼び方。すべて小文字で持つ。
  aliases: string[];
  run: Command;
}

const listItem = schema.nodes.listItem;

// いまの塊を素の段落に戻す。箇条書きの中なら項目ごと外へ出す。
// もともと素の段落なら何もしない（目印を落として無用な組み直しを招かない）。
const toText = chainCommands(liftListItem(listItem), (state, dispatch, view) =>
  state.selection.$from.parent.type === schema.nodes.paragraph
    ? false
    : setBlockType(schema.nodes.paragraph)(state, dispatch, view),
);

const toBullet = wrapInList(schema.nodes.bulletList, { marker: "-", tight: true });

// タスクの箇条書き。包んだ直後の項目に未了の印を付ける。
const toTodo: Command = (state, dispatch, view) =>
  toBullet(
    state,
    dispatch &&
      ((tr) => {
        const { $from } = tr.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type !== listItem) continue;
          tr.setNodeMarkup($from.before(d), undefined, { checked: false });
          break;
        }
        dispatch(tr);
      }),
    view,
  );

// その塊の場所に、この種類のブロックを置けるか。
const fits = ($from: ResolvedPos, type: NodeType): boolean =>
  $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), type);

// いまの塊を、新しい囲みの中身にする。書きかけの文字はそのまま引き継ぐ。
function toWrapper(type: NodeType, attrs: Attrs): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock || !fits($from, type)) return false;
    if (dispatch) {
      const inner = schema.nodes.paragraph.create(null, $from.parent.content);
      const at = $from.before();
      const tr = state.tr.replaceRangeWith(at, $from.after(), type.create(attrs, inner));
      // 中身の先頭から書き始められるようにする。
      dispatch(
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1), 1)).scrollIntoView(),
      );
    }
    return true;
  };
}

// 線は手前に差し込む。いまの塊はそのまま残るので、続けて書ける。
const insertRule: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const hr = schema.nodes.thematicBreak;
  if (!$from.parent.isTextblock || !fits($from, hr)) return false;
  if (dispatch) {
    dispatch(state.tr.insert($from.before(), hr.create({ marker: "---" })).scrollIntoView());
  }
  return true;
};

const headings: SlashItem[] = [1, 2, 3, 4].map((level) => {
  const hashes = "#".repeat(level);
  return {
    id: `h${level}`,
    label: `見出し ${level}`,
    icon: `format_h${level}`,
    hint: `${hashes} `,
    aliases: [`h${level}`, `heading${level}`, `midashi${level}`, hashes],
    run: setBlockType(schema.nodes.heading, { level }),
  };
});

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "text",
    label: "テキスト",
    icon: "text_fields",
    hint: "",
    aliases: ["text", "plain", "paragraph", "tekisuto", "段落", "本文"],
    run: toText,
  },
  ...headings,
  {
    id: "bullet",
    label: "箇条書きリスト",
    icon: "format_list_bulleted",
    hint: "- ",
    aliases: ["ul", "bullet", "bulletlist", "list", "kajogaki", "-"],
    run: toBullet,
  },
  {
    id: "ordered",
    label: "番号付きリスト",
    icon: "format_list_numbered",
    hint: "1. ",
    aliases: ["ol", "ordered", "orderedlist", "number", "bango", "1."],
    run: wrapInList(schema.nodes.orderedList, { marker: ".", start: 1, tight: true }),
  },
  {
    id: "todo",
    label: "TODO リスト",
    icon: "checklist",
    hint: "- [ ] ",
    aliases: ["todo", "task", "check", "checkbox", "タスク", "チェック"],
    run: toTodo,
  },
  {
    id: "toggle",
    label: "トグルリスト",
    icon: "expand_more",
    hint: "",
    aliases: ["toggle", "details", "togure", "折りたたみ"],
    run: toWrapper(schema.nodes.details, { head: DETAILS_HEAD }),
  },
  {
    id: "callout",
    label: "コールアウト",
    icon: "lightbulb",
    hint: "",
    aliases: ["callout", "note", "info", "kooruauto", "囲み"],
    run: toWrapper(schema.nodes.callout, { icon: "💡", color: null }),
  },
  {
    id: "rule",
    label: "区切り線",
    icon: "horizontal_rule",
    hint: "---",
    aliases: ["hr", "divider", "rule", "line", "kugiri", "---"],
    run: insertRule,
  },
];

// 表示名と別名の両方で当てる。
export function slashItems(query: string): SlashItem[] {
  const want = query.toLowerCase();
  if (!want) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(want) ||
      item.aliases.some((alias) => alias.includes(want)),
  );
}

// ---- 小窓の状態 ----

export interface SlashState {
  // "/" の位置。
  from: number;
  // "/" の後ろに打った絞り込みの文字。
  query: string;
  // いま選ばれている候補の番号。
  active: number;
}

type Meta =
  | { type: "open"; from: number }
  | { type: "close" }
  | { type: "move"; by: number }
  | { type: "at"; index: number };

export const slashKey = new PluginKey<SlashState | null>("slash");

// 小窓を出すのは段落と見出しの先頭だけ。文の途中の "/"（URL やパス）や
// コードの塊の中では邪魔しない。
function canOpen(state: EditorState): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const type = $from.parent.type;
  return type === schema.nodes.paragraph || type === schema.nodes.heading;
}

// "/" とその後ろに打った文字を読む。小窓を閉じるべき状態なら null。
function queryAt(state: EditorState, from: number): string | null {
  if (!state.selection.empty || from < 0 || from >= state.doc.content.size) return null;
  const $from = state.doc.resolve(from);
  const $head = state.selection.$head;
  if (!$from.sameParent($head)) return null;

  const at = from - $from.start();
  const to = $head.parentOffset;
  if (at < 0 || to <= at || at + 1 > $from.parent.content.size) return null;
  if ($from.parent.textBetween(at, at + 1) !== "/") return null;

  const text = $from.parent.textBetween(at + 1, to);
  // 空白まで打ったら、ただの文字として書きたい合図と見る。
  return /\s/.test(text) ? null : text;
}

// 決めた構造にする。"/" と絞り込みの文字は先に消す。
function take(view: EditorView, item: SlashItem, from: number) {
  const tr = view.state.tr.delete(from, view.state.selection.head);
  view.dispatch(tr.setMeta(slashKey, { type: "close" } satisfies Meta));
  item.run(view.state, view.dispatch, view);
  if (!view.hasFocus()) view.focus();
}

// ---- 小窓 ----

// 下に入らなければ上へ出す。カーソルの座標に頭を揃える。
function place(menu: HTMLElement, view: EditorView, from: number) {
  let at: { top: number; bottom: number; left: number };
  try {
    at = view.coordsAtPos(from);
  } catch {
    return;
  }
  const box = menu.getBoundingClientRect();
  const below = window.innerHeight - at.bottom;
  menu.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8))}px`;
  menu.style.top =
    below > box.height + 12
      ? `${at.bottom + 6}px`
      : `${Math.max(8, at.top - box.height - 6)}px`;
}

class SlashMenu implements PluginView {
  private view: EditorView;
  private menu: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private list: HTMLElement | null = null;

  private onOutside = (e: MouseEvent) => {
    if (this.menu?.contains(e.target as Node)) return;
    this.view.dispatch(this.view.state.tr.setMeta(slashKey, { type: "close" } satisfies Meta));
  };

  constructor(view: EditorView) {
    this.view = view;
    this.update(view);
  }

  update(view: EditorView) {
    this.view = view;
    const now = slashKey.getState(view.state);
    if (!now) {
      this.close();
      return;
    }
    this.open();
    this.draw(now);
  }

  destroy() {
    this.close();
  }

  private open() {
    if (this.menu) return;
    const menu = document.createElement("div");
    menu.className = "mg-slash";

    const find = document.createElement("div");
    find.className = "mg-slash-find";
    find.appendChild(icon("search", 17));
    const label = document.createElement("span");
    label.className = "mg-slash-q";
    find.appendChild(label);
    menu.appendChild(find);

    const list = document.createElement("div");
    list.className = "mg-slash-list";
    menu.appendChild(list);

    document.body.appendChild(menu);
    document.addEventListener("mousedown", this.onOutside, true);
    this.menu = menu;
    this.label = label;
    this.list = list;
  }

  private close() {
    if (!this.menu) return;
    document.removeEventListener("mousedown", this.onOutside, true);
    this.menu.remove();
    this.menu = null;
    this.label = null;
    this.list = null;
  }

  private draw(now: SlashState) {
    if (!this.menu || !this.label || !this.list) return;
    this.label.textContent = now.query ? `/${now.query}` : "ブロックを選ぶ";
    this.label.classList.toggle("is-empty", !now.query);

    const rows = slashItems(now.query).map((item, i) => this.row(item, i, i === now.active, now));
    this.list.replaceChildren(...rows);
    rows[now.active]?.scrollIntoView?.({ block: "nearest" });
    place(this.menu, this.view, now.from);
  }

  private row(item: SlashItem, index: number, on: boolean, now: SlashState): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "mg-slash-row";
    if (on) row.classList.add("is-active");

    row.appendChild(icon(item.icon, 18));
    const label = document.createElement("span");
    label.className = "mg-slash-label";
    label.textContent = item.label;
    row.appendChild(label);
    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "mg-slash-hint";
      hint.textContent = item.hint;
      row.appendChild(hint);
    }

    // 押した拍子に編集面から焦点が外れると、書いていた場所を見失う。
    row.addEventListener("mousedown", (e) => e.preventDefault());
    row.addEventListener("mouseenter", () => {
      this.view.dispatch(
        this.view.state.tr.setMeta(slashKey, { type: "at", index } satisfies Meta),
      );
    });
    row.addEventListener("click", () => take(this.view, item, now.from));
    return row;
  }
}

export const slashMenu = new Plugin<SlashState | null>({
  key: slashKey,
  state: {
    init: () => null,
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(slashKey) as Meta | undefined;
      if (meta?.type === "open") return { from: meta.from, query: "", active: 0 };
      if (meta?.type === "close" || !prev) return null;

      const from = tr.docChanged ? tr.mapping.map(prev.from, -1) : prev.from;
      const query = queryAt(next, from);
      if (query === null) return null;
      const shown = slashItems(query);
      // 該当が無くなったら閉じる。打った文字は本文に残る。
      if (!shown.length) return null;

      if (meta?.type === "move") {
        const active = (prev.active + meta.by + shown.length) % shown.length;
        return { from, query, active };
      }
      if (meta?.type === "at") {
        return { from, query, active: Math.min(Math.max(meta.index, 0), shown.length - 1) };
      }
      if (query !== prev.query) return { from, query, active: 0 };
      return from === prev.from ? prev : { ...prev, from };
    },
  },
  props: {
    handleTextInput(view, from, to, text) {
      // 変換中は横取りしない。
      if (text !== "/" || view.composing || !canOpen(view.state)) return false;
      view.dispatch(
        view.state.tr
          .insertText("/", from, to)
          .setMeta(slashKey, { type: "open", from } satisfies Meta),
      );
      return true;
    },

    handleKeyDown(view, event) {
      const now = slashKey.getState(view.state);
      if (!now || view.composing) return false;
      const send = (meta: Meta) => view.dispatch(view.state.tr.setMeta(slashKey, meta));

      switch (event.key) {
        case "Escape":
          send({ type: "close" });
          return true;
        case "ArrowDown":
          send({ type: "move", by: 1 });
          return true;
        case "ArrowUp":
          send({ type: "move", by: -1 });
          return true;
        case "Enter": {
          const item = slashItems(now.query)[now.active];
          if (!item) return false;
          take(view, item, now.from);
          return true;
        }
        default:
          return false;
      }
    },
  },
  view: (view) => new SlashMenu(view),
});
