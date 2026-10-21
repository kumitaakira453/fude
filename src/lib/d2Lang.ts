import { StreamLanguage, type StringStream } from "@codemirror/language";
import { KEYS, VALUES } from "./md/d2";

// .d2 のファイルを書く面（CodeMirror）の色付け。読むとき（highlight.js の d2）と
// 同じ語を同じ色の役に当てる。色は mermaidHighlight と同じ HighlightStyle で付く。

const KEYWORDS = new Set(KEYS);
const BUILTINS = new Set(VALUES.split(" "));
const LITERALS = new Set(["true", "false", "null"]);
// 名前。日本語も、grid-rows のように - を含む語もひとまとまりで進める。
const WORD = /^[\wÀ-￿]+(?:-[\wÀ-￿]+)*/;

export interface D2State {
  // |md … | のような、何行にも渡る字の中か。
  block: boolean;
}

export const d2Mode = {
  name: "d2",
  startState(): D2State {
    return { block: false };
  },
  token(stream: StringStream, state: D2State): string | null {
    if (state.block) {
      if (stream.sol() && stream.match(/^\s*\|/)) {
        state.block = false;
        return "string";
      }
      stream.skipToEnd();
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^\|[a-z]*\s*$/)) {
      state.block = true;
      return "string";
    }
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === "\\") stream.next();
        else if (c === ch) break;
      }
      return "string";
    }
    if (stream.match(/^(<->|<-|->|--)/)) return "operator";
    if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
    const word = stream.match(WORD);
    if (Array.isArray(word)) {
      const w = word[0];
      if (KEYWORDS.has(w)) return "keyword";
      if (BUILTINS.has(w)) return "number";
      if (LITERALS.has(w)) return "number";
      // 行の頭の名前（名前: ラベル）。
      return /^\s*:/.test(stream.string.slice(stream.pos)) ? "labelName" : null;
    }
    stream.next();
    return null;
  },
};

export const d2Lang = StreamLanguage.define(d2Mode);
