import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// Obsidian 風ライブプレビュー:
// - 構文マーカー(#, **, ` など)はカーソルの無い行では隠し、内容を整形表示
// - カーソル/選択のある行では生ソースをそのまま見せる（編集しやすさ）

const HIDE = Decoration.replace({});
const headingLine = (lvl: number) => Decoration.line({ class: `cm-lp-h${lvl}` });
const mark = (cls: string) => Decoration.mark({ class: cls });

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = view.state.doc;

  // カーソル/選択が乗っている行番号（生ソースを見せる行）
  const activeLines = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) activeLines.add(l);
  }
  const isActive = (pos: number) => activeLines.has(doc.lineAt(pos).number);
  const hideIfInactive = (from: number, to: number) => {
    if (from < to && !isActive(from)) decos.push(HIDE.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const m = /^ATXHeading(\d)$/.exec(name);
        if (m) {
          decos.push(headingLine(+m[1]).range(doc.lineAt(node.from).from));
          return;
        }
        switch (name) {
          case "HeaderMark": {
            // '#'（＋直後の空白）を隠す
            const line = doc.lineAt(node.from);
            let end = node.to;
            if (end < line.to && doc.sliceString(end, end + 1) === " ") end += 1;
            hideIfInactive(node.from, end);
            break;
          }
          case "StrongEmphasis":
            decos.push(mark("cm-lp-bold").range(node.from, node.to));
            break;
          case "Emphasis":
            decos.push(mark("cm-lp-italic").range(node.from, node.to));
            break;
          case "Strikethrough":
            decos.push(mark("cm-lp-strike").range(node.from, node.to));
            break;
          case "InlineCode":
            decos.push(mark("cm-lp-code").range(node.from, node.to));
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark":
          case "LinkMark":
            hideIfInactive(node.from, node.to);
            break;
          case "URL":
            hideIfInactive(node.from, node.to);
            break;
          case "Link":
            decos.push(mark("cm-lp-link").range(node.from, node.to));
            break;
          case "QuoteMark":
            hideIfInactive(node.from, Math.min(node.to + 1, doc.lineAt(node.from).to));
            break;
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
