import { chainCommands, lift, setBlockType, wrapIn } from "prosemirror-commands";
import {
  Fragment,
  type Attrs,
  type Node as PmNode,
  type NodeType,
  type ResolvedPos,
} from "prosemirror-model";
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
import { openEmojiBoard } from "./emoji";
import { openImagePick } from "./imagePick";
import { openMath } from "./math";
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
  // いまの塊を変えるのではなく、新しく置くもの。選んだ文字から出す変換の
  // 一覧には出さない。
  inserts?: boolean;
  run: Command;
}

const listItem = schema.nodes.listItem;

// いまの塊を素の段落に戻す。箇条書きの中なら項目ごと外へ出し、引用や囲みの
// 中なら 1 段外へ出す。
// もともと素の段落なら何もしない（目印を落として無用な組み直しを招かない）。
const toText = chainCommands(
  liftListItem(listItem),
  (state, dispatch, view) =>
    state.selection.$from.parent.type === schema.nodes.paragraph
      ? false
      : setBlockType(schema.nodes.paragraph)(state, dispatch, view),
  lift,
);

const BULLET = { marker: "-", tight: true };
const ORDERED = { marker: ".", start: 1, tight: true };

const wrapBullet = wrapInList(schema.nodes.bulletList, BULLET);

const isList = (node: PmNode): boolean =>
  node.type === schema.nodes.bulletList || node.type === schema.nodes.orderedList;

// カーソルの居る、いちばん外の並び。入れ子の項目から呼んでも、塊そのものを返す。
function outerList($from: ResolvedPos): { node: PmNode; pos: number } | null {
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (isList(node)) return { node, pos: $from.before(d) };
  }
  return null;
}

// いま居る並びを、別の形に付け替える。種類（点／番号）と、項目の印（チェック）
// を一度に入れ替える。相手は塊まるごとで、入れ子の項目にも効く。
//
// wrapInList は、同じ中身を持てる並びの中では何もしない（prosemirror が false
// を返す）。点の並びを番号や TODO に変える道がそこには無いので、ここで受ける。
function retype(type: NodeType, attrs: Attrs, checked: boolean | null): Command {
  return (state, dispatch) => {
    const here = outerList(state.selection.$from);
    if (!here) return false;
    const { node, pos } = here;

    // 種類も印も中身の大きさを変えないので、先に位置を集めておける。
    const lists: { at: number; node: PmNode }[] = [{ at: pos, node }];
    const items: { at: number; node: PmNode }[] = [];
    node.descendants((child, offset) => {
      const at = pos + 1 + offset;
      if (child.type === listItem) items.push({ at, node: child });
      else if (isList(child)) lists.push({ at, node: child });
      return true;
    });

    const sameKind = lists.every((one) => one.node.type === type);
    const sameMark = items.every(
      (one) => (one.node.attrs.checked === null) === (checked === null),
    );
    if (sameKind && sameMark) return false;

    if (dispatch) {
      const tr = state.tr;
      for (const one of lists) {
        // 目印を落として組み直させる。原文の "- あ" をそのまま出されると、
        // 付け替えた種類も印も書き戻りに現れない。
        tr.setNodeMarkup(
          one.at,
          type,
          one.node.type === type
            ? { ...one.node.attrs, id: null }
            : { ...attrs, id: null, tight: one.node.attrs.tight },
        );
      }
      for (const one of items) {
        const now = checked === null ? null : (one.node.attrs.checked ?? false);
        if (one.node.attrs.checked !== now) {
          tr.setNodeMarkup(one.at, undefined, { ...one.node.attrs, checked: now });
        }
      }
      dispatch(tr);
    }
    return true;
  };
}

// 点の箇条書き。TODO や番号から戻すときは、並びごと付け替える。
const toBullet = chainCommands(retype(schema.nodes.bulletList, BULLET, null), wrapBullet);

const toOrdered = chainCommands(
  retype(schema.nodes.orderedList, ORDERED, null),
  wrapInList(schema.nodes.orderedList, ORDERED),
);

// タスクの箇条書き。並びの中なら項目に印を付け、外なら包んでから印を付ける。
const toTodo = chainCommands(
  retype(schema.nodes.bulletList, BULLET, false),
  (state, dispatch, view) =>
    wrapBullet(
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
    ),
);

// その塊の場所に、この種類のブロックを置けるか。
const fits = ($from: ResolvedPos, type: NodeType): boolean =>
  $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), type);

// いまの塊を、新しい囲みの中身にする。書きかけの文字はそのまま引き継ぐ。
//
// 選んでいる範囲があっても効く。選んだ文字から出す帯からも呼ぶので、
// 「カーソルだけ」を要求すると押しても何も起きない。
function toWrapper(type: NodeType, attrs: Attrs): Command {
  return (state, dispatch) => {
    const { $from, $to, from, to } = state.selection;
    if (!$from.sameParent($to) || !$from.parent.isTextblock || !fits($from, type)) {
      return false;
    }
    if (dispatch) {
      const inner = schema.nodes.paragraph.create(null, $from.parent.content);
      const at = $from.before();
      const tr = state.tr.replaceRangeWith(at, $from.after(), type.create(attrs, inner));
      // 選んでいたところはそのまま選んだままにする。囲みが 1 段深くなるので、
      // 位置は 1 つずれる。
      dispatch(
        tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1)).scrollIntoView(),
      );
    }
    return true;
  };
}

// トグル要素。見出しの上で使うと、その見出しがトグルの頭になる（見出しは
// <summary> の中へ移り、中身は空から書き始める）。段落なら今までどおり、
// 書きかけの文字がトグルの中身になる。
const toToggle: Command = (state, dispatch) => {
  const { $from, $to, from, to, empty } = state.selection;
  const details = schema.nodes.details;
  if (!$from.sameParent($to) || !$from.parent.isTextblock || !fits($from, details)) {
    return false;
  }
  const block = $from.parent;
  const heading = block.type === schema.nodes.heading;

  if (dispatch) {
    // 見出しなら、その見出しがトグルの題になる（中身は空から書き始める）。
    // 段落なら、書きかけの字が中身に入り、題は空のまま。
    const title = schema.nodes.detailsSummary.create(
      { level: heading ? (block.attrs.level as number) : null },
      heading ? block.content : undefined,
    );
    const body = schema.nodes.paragraph.create(null, heading ? undefined : block.content);
    const at = $from.before();
    const tr = state.tr.replaceRangeWith(
      at,
      $from.after(),
      details.create({ head: DETAILS_HEAD }, [title, body]),
    );
    // 字を選んで変えたときは、選んだところをそのまま選んだままにする
    // （囲みと題のぶんだけ位置が内側へずれる）。それ以外は、見出しなら中身から、
    // 素のトグルなら題から書き始める。
    const shift = 1 + title.nodeSize;
    dispatch(
      tr
        .setSelection(
          empty
            ? TextSelection.near(
                tr.doc.resolve(heading ? at + title.nodeSize + 1 : at + 1),
                1,
              )
            : TextSelection.create(tr.doc, from + shift, to + shift),
        )
        .scrollIntoView(),
    );
  }
  return true;
};

// 表のセルは行を分けられないので、行内の改行は <br> に移す
// （セルの中で改行を打ったときと同じ形）。
function cellContent(content: Fragment): Fragment {
  const out: PmNode[] = [];
  content.forEach((node) => {
    out.push(
      node.type === schema.nodes.hardBreak
        ? schema.nodes.rawInline.create({ value: "<br>" })
        : node,
    );
  });
  return Fragment.from(out);
}

// 3 行 × 3 列の表。見出し行 1 と本文 2 行。桁幅と区切り行は原文へ書き戻す
// ときに組み直すので、覚えずに作る。書きかけの文字は左上のセルに入れる。
const insertTable: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const { table, tableRow, tableCell } = schema.nodes;
  if (!empty || !$from.parent.isTextblock || !fits($from, table)) return false;
  if (dispatch) {
    const row = (header: boolean, head?: Fragment) =>
      tableRow.create(null, [
        tableCell.create({ header }, head),
        tableCell.create({ header }),
        tableCell.create({ header }),
      ]);
    const node = table.create({ align: [], widths: [], delim: null }, [
      row(true, cellContent($from.parent.content)),
      row(false),
      row(false),
    ]);
    const at = $from.before();
    const tr = state.tr.replaceRangeWith(at, $from.after(), node);
    // 左上のセルから書き始められるようにする（表 → 行 → セルで 3 つ内側）。
    dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3), 1)).scrollIntoView(),
    );
  }
  return true;
};

// 行内の式。カーソルのところへ空の式を置き、そのまま中身を聞く。
const insertInlineMath: Command = (state, dispatch, view) => {
  const type = schema.nodes.inlineMath;
  if (!state.selection.$from.parent.isTextblock) return false;
  if (dispatch) {
    const at = state.selection.from;
    // 装飾は継がせない。式を太字にしても組み方は変わらないのに、原文には
    // 記号が残る。
    dispatch(state.tr.replaceSelectionWith(type.create({ tex: "", raw: null }), false));
    if (view) openMath(view, at);
  }
  return true;
};

// 独立した式。書きかけの字が無ければその塊を置き換え、あれば後ろに足す。
const insertMathBlock: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  const type = schema.nodes.mathBlock;
  if (!$from.parent.isTextblock || !fits($from, type)) return false;
  if (dispatch) {
    const node = type.create({ tex: "", raw: null });
    const empty = $from.parent.content.size === 0;
    const at = empty ? $from.before() : $from.after();
    const tr = empty
      ? state.tr.replaceRangeWith(at, $from.after(), node)
      : state.tr.insert(at, node);
    dispatch(tr.scrollIntoView());
    if (view) openMath(view, at);
  }
  return true;
};

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
    aliases: [`h${level}`, `${level}`, `heading${level}`, `midashi${level}`, hashes],
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
    aliases: ["ol", "ordered", "orderedlist", "number", "numbered", "bango", "1."],
    run: toOrdered,
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
    label: "トグル要素",
    icon: "expand_more",
    hint: "",
    aliases: ["toggle", "details", "togure", "トグル", "折りたたみ"],
    run: toToggle,
  },
  {
    id: "quote",
    label: "引用",
    icon: "format_quote",
    hint: "> ",
    aliases: ["quote", "blockquote", "inyo", ">"],
    run: wrapIn(schema.nodes.blockquote),
  },
  {
    id: "code",
    label: "コード",
    icon: "code_blocks",
    hint: "```",
    aliases: ["code", "codeblock", "pre", "kodo", "```"],
    run: setBlockType(schema.nodes.codeBlock),
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
    id: "emoji",
    label: "絵文字",
    icon: "mood",
    hint: ":",
    aliases: ["emoji", "emo", "icon", "絵文字", "顔"],
    inserts: true,
    run: (_state, _dispatch, view) => {
      if (!view) return false;
      openEmojiBoard(view);
      return true;
    },
  },
  {
    id: "image",
    label: "画像",
    icon: "image",
    hint: "",
    aliases: ["image", "img", "gazou", "画像", "写真", "図"],
    inserts: true,
    run: (_state, _dispatch, view) => {
      if (!view) return false;
      openImagePick(view);
      return true;
    },
  },
  {
    id: "table",
    label: "テーブル",
    icon: "table",
    hint: "",
    aliases: ["table", "teburu", "表", "グリッド"],
    inserts: true,
    run: insertTable,
  },
  {
    id: "math",
    label: "インライン式",
    icon: "superscript",
    hint: "$",
    aliases: ["math", "tex", "katex", "equation", "inlinemath", "式", "数式"],
    inserts: true,
    run: insertInlineMath,
  },
  {
    id: "mathBlock",
    label: "式ブロック",
    icon: "functions",
    hint: "$$",
    aliases: ["math", "tex", "katex", "equation", "mathblock", "式", "数式", "式ブロック"],
    inserts: true,
    run: insertMathBlock,
  },
  {
    id: "rule",
    label: "区切り線",
    icon: "horizontal_rule",
    hint: "---",
    aliases: ["hr", "divider", "rule", "line", "kugiri", "---"],
    inserts: true,
    run: insertRule,
  },
];

// 当たり方の強さ。別名の丸ごと一致 → 別名の頭一致 → 表示名の頭一致 →
// どこかに含む。当たらなければ -1。
//
// 打つのは英字の別名（"table" や "h2"）が主軸なので、頭から一致するものを
// 先に出す。"h" で見出しが並び、"h2" で見出し 2 が先頭に来る。
const RANKS = 4;

function rank(item: SlashItem, want: string): number {
  if (item.aliases.includes(want)) return 0;
  if (item.aliases.some((alias) => alias.startsWith(want))) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(want)) return 2;
  if (label.includes(want) || item.aliases.some((alias) => alias.includes(want))) return 3;
  return -1;
}

// 表示名と別名の両方で当てる。強い順に並べ、同じ強さの中は一覧の並びのまま。
export function slashItems(query: string): SlashItem[] {
  const want = query.toLowerCase();
  if (!want) return SLASH_ITEMS;
  const buckets: SlashItem[][] = Array.from({ length: RANKS }, () => []);
  for (const item of SLASH_ITEMS) {
    const at = rank(item, want);
    if (at >= 0) buckets[at].push(item);
  }
  return buckets.flat();
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
  if (!empty) return false;
  // 前に字が無ければ先頭とみなす。絵のような行内の塊は数えない（絵は塊の
  // ように描かれるので、その下の行に見える位置が同じ段落の中にある）。
  if ($from.parent.textBetween(0, $from.parentOffset) !== "") return false;
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
