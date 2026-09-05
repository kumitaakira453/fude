import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

// 図の書き方は種類ごとに違うので、構文木ではなく語の並びで色を付ける。
// 拾うのは、図の種類と組み立ての語・注記・文字列・数値・線の 5 つ。
const KEYWORDS = new Set([
  // 図の種類
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "classDiagram-v2",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "mindmap",
  "timeline",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "architecture-beta",
  "kanban",
  "treemap",
  // 向き
  "TD",
  "TB",
  "BT",
  "LR",
  "RL",
  // 組み立て
  "subgraph",
  "end",
  "direction",
  "participant",
  "actor",
  "note",
  "loop",
  "alt",
  "opt",
  "par",
  "critical",
  "break",
  "rect",
  "box",
  "activate",
  "deactivate",
  "autonumber",
  "class",
  "classDef",
  "click",
  "style",
  "linkStyle",
  "callback",
  "href",
  "state",
  "section",
  "dateFormat",
  "axisFormat",
  "todayMarker",
  "excludes",
  "commit",
  "branch",
  "checkout",
  "merge",
  "cherry-pick",
  "accTitle",
  "accDescr",
  "requirement",
  "element",
]);

// 線を組み立てる文字。始まりに置けるのは線を思わせるものだけで、
// `{` や `(` は形（A{判定} など）にも使うので始まりにはしない。
const LINK_START = /[-=.~<>|}*]/;
const LINK_BODY = /[-=.~<>|{}()*ox+]/;
const LINE = /[-=.~]/;
// 名前とラベル。日本語もひとまとまりで進めたいので、記号以外をまとめて取る。
const WORD = /^[\w\u00c0-\uffff-]+/;

export const mermaidMode = {
  name: "mermaid",
  token(stream: StringStream): string | null {
    if (stream.eatSpace()) return null;
    // 注記。%%{init: ...}%% の指示も同じ扱いでよい。
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "comment";
    }
    const ch = stream.peek();
    if (ch === undefined) {
      stream.next();
      return null;
    }
    if (ch === '"') {
      stream.next();
      while (!stream.eol()) {
        if (stream.next() === '"') break;
      }
      return "string";
    }
    if (LINK_START.test(ch)) {
      const from = stream.pos;
      let line = false;
      for (
        let c = stream.peek();
        c !== undefined && LINK_BODY.test(c);
        c = stream.peek()
      ) {
        if (LINE.test(c)) line = true;
        stream.next();
      }
      // 1 文字だけ、線を含まない並びは記号として扱わない（閉じ括弧など）。
      return line && stream.pos - from >= 2 ? "operator" : null;
    }
    if (/\d/.test(ch)) {
      stream.match(/^\d+(?:\.\d+)?/);
      return "number";
    }
    const word = stream.match(WORD);
    if (Array.isArray(word)) return KEYWORDS.has(word[0]) ? "keyword" : null;
    stream.next();
    return null;
  },
};

export const mermaidLang = StreamLanguage.define(mermaidMode);

// 色は本文のコードブロックと同じ変数を使う。テーマを変えれば一緒に変わる。
const style = HighlightStyle.define([
  { tag: tags.comment, color: "var(--sx-comment)", fontStyle: "italic" },
  { tag: tags.string, color: "var(--sx-str)" },
  { tag: tags.keyword, color: "var(--sx-key)" },
  { tag: tags.number, color: "var(--sx-num)" },
  { tag: tags.operator, color: "var(--sx-fn)" },
]);

export const mermaidHighlight = syntaxHighlighting(style);
