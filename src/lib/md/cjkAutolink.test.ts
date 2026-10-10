import type { Link, Paragraph, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { Slice } from "prosemirror-model";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { trimCjkAutolinks } from "./cjkAutolink";
import { fromMarkdown } from "./fromMarkdown";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// URL の自動リンクは、直後に続く全角の区切りまで含めない。日本語の文では
// URL の後ろに空白を置かずに「）」「：」「、」が続くのが普通。

const parse = (text: string) =>
  trimCjkAutolinks(unified().use(remarkParse).use(remarkGfm).parse(text) as Root);

// 段落の中身を、リンクは [字](url)、字はそのままで並べる。隣り合う字は
// つなぐ（パーサは字の節を細かく割ることがある）。
const flat = (text: string) => {
  const out: string[] = [];
  let run: string | null = null;
  for (const n of (parse(text).children[0] as Paragraph).children) {
    if (n.type === "text") {
      run = (run ?? "") + n.value;
      continue;
    }
    if (run !== null) out.push(run);
    run = null;
    out.push(
      n.type === "link"
        ? `[${(n as Link).children.map((c) => ("value" in c ? c.value : "")).join("")}](${n.url})`
        : n.type,
    );
  }
  if (run !== null) out.push(run);
  return out;
};

describe("自動リンクの末尾の全角の区切り", () => {
  it("閉じ括弧と句読点の手前で切り、残りは字にする", () => {
    expect(flat("（資料、https://x.example/a/b）：次")).toEqual([
      "（資料、",
      "[https://x.example/a/b](https://x.example/a/b)",
      "）：次",
    ]);
    expect(flat("https://x.example/a、と https://x.example/b。")).toEqual([
      "[https://x.example/a](https://x.example/a)",
      "、と ",
      "[https://x.example/b](https://x.example/b)",
      "。",
    ]);
  });

  it("www. で始まるものは http:// のまま切る", () => {
    expect(flat("www.example.com）")).toEqual([
      "[www.example.com](http://www.example.com)",
      "）",
    ]);
  });

  it("日本語の道筋は区切りではないので残す", () => {
    expect(flat("https://ja.wikipedia.org/wiki/日本 を見る")).toEqual([
      "[https://ja.wikipedia.org/wiki/日本](https://ja.wikipedia.org/wiki/日本)",
      " を見る",
    ]);
  });

  it("[字](URL) と書いたリンクには触らない", () => {
    expect(flat("[資料（第2版）：要点](https://x.example/a)")).toEqual([
      "[資料（第2版）：要点](https://x.example/a)",
    ]);
  });

  it("位置も切った所で分ける", () => {
    const para = parse("前 https://x.example/a）：後").children[0] as Paragraph;
    const link = para.children[1] as Link;
    const tail = para.children[2];
    expect(link.position?.start.offset).toBe(2);
    expect(link.position?.end.offset).toBe(2 + "https://x.example/a".length);
    expect(tail.position?.start.offset).toBe(link.position?.end.offset);
    expect(tail.position?.end.column).toBe(tail.position!.start.column + "）：後".length);
  });
});

it("残りは後ろの字と 1 つにまとめる（編集面の字の束ね方と合わせる）", () => {
  const para = parse("例（https://x.example/a）が設定 されている").children[0] as Paragraph;
  expect(para.children.map((n) => n.type)).toEqual(["text", "link", "text"]);
  const tail = para.children[2];
  expect("value" in tail && tail.value).toBe("）が設定 されている");
  expect(tail.position?.start.offset).toBe("例（https://x.example/a".length);
});

describe("編集面", () => {
  const src = "見本（資料、https://x.example/a/b）：本文\n";

  it("リンクの印は URL の字だけに付く", () => {
    const { doc } = fromMarkdown(src);
    const linked: string[] = [];
    doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type === schema.marks.link)) linked.push(n.text ?? "");
    });
    expect(linked).toEqual(["https://x.example/a/b"]);
  });

  it("段落の 1 文字を消しても、その 1 文字だけが変わる", () => {
    const body = "例2: URL（https://example.com）がA, Bに設定されている\n";
    const loaded = fromMarkdown(body);
    let at = -1;
    loaded.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text!.includes("設定")) at = pos + n.text!.indexOf("設定");
      return at < 0;
    });
    const edited = loaded.doc.replace(at, at + 1, Slice.empty);
    expect(toMarkdown(edited, loaded)).toBe("例2: URL（https://example.com）がA, Bに定されている\n");
  });

  it("書き戻すと原文のまま戻る", () => {
    const loaded = fromMarkdown(src);
    expect(toMarkdown(loaded.doc, loaded)).toBe(src);
  });
});
