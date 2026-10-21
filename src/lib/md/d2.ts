import type { HLJSApi, Language } from "highlight.js";

// D2（図の記述）の読み取り。
//
// highlight.js は D2 を持たないので、```d2 のコードの塊も .d2 のファイルも色が
// 付かない。読むとき（rehype-highlight）と書くとき（編集面の装飾）の両方が同じ
// ものを使う。

// 予約の鍵。形や見た目を決める語で、ノードの名前とは別の色にする。
export const KEYS = [
  "shape",
  "style",
  "label",
  "tooltip",
  "link",
  "icon",
  "near",
  "direction",
  "vars",
  "classes",
  "class",
  "width",
  "height",
  "top",
  "left",
  "grid-rows",
  "grid-columns",
  "grid-gap",
  "vertical-gap",
  "horizontal-gap",
  "layers",
  "scenarios",
  "steps",
  "constraint",
  "d2-config",
  "layout-engine",
  "theme-id",
  "dark-theme-id",
  "pad",
  "sketch",
  "source-arrowhead",
  "target-arrowhead",
  "filled",
  "opacity",
  "stroke",
  "stroke-width",
  "stroke-dash",
  "fill",
  "font-size",
  "font-color",
  "bold",
  "italic",
  "underline",
  "multiple",
  "shadow",
  "3d",
  "animated",
  "border-radius",
];

// 形・向き・組み方などの決まった値。
export const VALUES =
  "rectangle square page parallelogram document cylinder queue package step callout " +
  "stored_data person diamond oval circle hexagon cloud text code class sql_table image " +
  "sequence_diagram up down left right dagre elk tala triangle arrow cf-one cf-many " +
  "cf-one-required cf-many-required";

const escape = (s: string) => s.replace(/[-]/g, "\\-");

export function d2(hljs: HLJSApi): Language {
  return {
    name: "D2",
    keywords: {
      // grid-rows のように - を含む鍵も 1 語として拾う。
      $pattern: "[\\w-]+",
      keyword: KEYS.join(" "),
      built_in: VALUES,
      literal: "true false null",
    },
    contains: [
      hljs.COMMENT("#", "$"),
      // 何行にも渡る字（|md … | のような囲み）。
      { className: "string", begin: /\|[a-z]*\s*$/m, end: /^\s*\|/m },
      { className: "string", begin: /"/, end: /"/, illegal: /\n/, contains: [{ begin: /\\./ }] },
      { className: "string", begin: /'/, end: /'/, illegal: /\n/, contains: [{ begin: /\\./ }] },
      // 線（a -> b、a <-> b、a -- b）。
      { className: "operator", begin: /<->|<-|->|--/ },
      hljs.NUMBER_MODE,
      // 行の頭の名前（名前: ラベル）。予約の鍵は別の色なので除く。
      {
        className: "attr",
        begin: new RegExp(
          `^[ \\t]*(?!(?:${KEYS.map(escape).join("|")})\\s*:)[\\w\\u00c0-\\uffff.]+(?=\\s*:)`,
          "m",
        ),
      },
    ],
  };
}
