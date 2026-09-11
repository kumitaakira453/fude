// Notion から降りてくる md には、行だけのタグで囲まれた塊が空行なしで書かれている。
// CommonMark はこれを 1 つの HTML ブロックとして丸ごと生 HTML に落とすので、中の
// `code` や **強調** が記号のまま出る。
//
// 中身の前後に空行を入れると開きタグの行がそこで閉じ、中身は段落として読まれ、
// rehype-raw が前後の生 HTML と繋ぎ直す。描画に渡す文字列だけを組み替え、
// 位置は `back` で原文へ戻せるようにする（セルの編集と項目のコメントは原文の
// 位置で持っているので、ずれたままでは使えない）。

import {
  CONTAINERS,
  closeLineOf,
  commonIndent,
  indentOf,
  innerPad,
  kindOf,
  lostList,
  unpadLines,
} from "./htmlSpans";

const SUMMARY = /^<summary(\s[^>]*)?>.*<\/summary>$/;

function attr(attrs: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : "";
}

// 属性から拾った文字をそのまま埋めると、タグとして解釈される余地が残る。
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface Opened {
  text: string;
  // 組み替えた文字列の位置から、原文の位置へ戻す。
  back: (at: number) => number;
}

// 出す 1 行。text[lead] が原文の at に当たる（lead より前は足した字）。
interface Row {
  text: string;
  at: number;
  lead: number;
}

// 区間の中の位置を原文の位置へ写す。
type Back = (at: number) => number;

export function openHtmlContainers(src: string): Opened {
  const same = { text: src, back: (at: number) => at };
  // 親の項目を失った一覧は、字下げを落とさないとコードとして読まれる。
  const flat = lostList(src) ? unpadLines(src, commonIndent(src.split("\n"))) : null;
  if (!flat && !src.includes("<callout") && !src.includes("<details")) return same;

  const rows = open(flat ? flat.text : src, flat ? flat.back : (at) => at);
  const out = join(rows);
  return out.text === src ? same : out;
}

function open(src: string, back: Back): Row[] {
  const lines = src.split("\n");
  // 行の頭が、この文字列のどこから始まるか。
  const heads: number[] = [];
  let at = 0;
  for (const line of lines) {
    heads.push(at);
    at += line.length + 1;
  }
  const row = (i: number): Row => ({ text: lines[i], at: back(heads[i]), lead: 0 });
  const held = (text: string, i: number): Row => ({
    text,
    at: back(heads[i]),
    lead: text.length,
  });
  const blank = (i: number): Row => held("", i);

  const out: Row[] = [];

  for (let i = 0; i < lines.length; i++) {
    const kind = kindOf(lines[i]);
    const close = kind ? closeLineOf(lines, i, kind) : -1;
    if (!kind || close < 0) {
      out.push(row(i));
      continue;
    }

    const pad = indentOf(lines[i]);
    // 見出し（summary）は開きタグの直後に置いたままにする。離すと開閉の
    // 見出しにならず、ただの段落になってしまう。
    const head =
      kind === "details" && SUMMARY.test((lines[i + 1] ?? "").trim()) ? i + 2 : i + 1;

    if (kind === "details") {
      for (let k = i; k < head; k++) out.push(row(k));
      out.push(blank(head - 1));
    } else {
      out.push(wrapper(lines[i], pad, back(heads[i])), blank(i));
    }

    out.push(...body(lines.slice(head, close), heads[head] ?? heads[close], pad));

    out.push(blank(close));
    out.push(
      kind === "details" ? row(close) : held(`${pad}</div></div>`, close),
    );
    i = close;
  }

  return out;

  // 中身。囲みが立っている桁に合わせ直してから、中の囲みもほどく。
  function body(inner: string[], at: number, pad: string): Row[] {
    if (!inner.length) return [];
    const text = inner.join("\n");
    const cut = unpadLines(text, innerPad(inner, pad));
    const rows = cut
      ? open(cut.text, (o) => back(at + cut.back(o)))
      : open(text, (o) => back(at + o));
    if (!pad) return rows;
    return rows.map((r) =>
      r.text === "" ? r : { ...r, text: pad + r.text, lead: r.lead + pad.length },
    );
  }
}

// callout は飾りの付く div に組み替える。details は原文のタグのまま出す
// （ブラウザの開閉がそのまま使える）。
function wrapper(line: string, pad: string, at: number): Row {
  const attrs = CONTAINERS.callout.open.exec(line.trim())?.[1] ?? "";
  const icon = escapeText(attr(attrs, "icon"));
  // 色は Notion の名前（gray_bg / blue_bg など）のまま渡し、装飾は CSS で決める。
  const color = /^[a-z_]+$/.test(attr(attrs, "color"))
    ? ` data-color="${attr(attrs, "color")}"`
    : "";
  // 押すとアイコンを選び直せる。目印だけ置き、扱いは描画側に任せる。
  const ico = `<span class="mg-callout-ico" data-mg-callout-ico="1">${icon}</span>`;
  const text = `${pad}<div class="mg-callout notion"${color}>${ico}<div class="mg-callout-body">`;
  return { text, at, lead: text.length };
}

function join(rows: Row[]): Opened {
  const text = rows.map((r) => r.text).join("\n");
  const starts: number[] = [];
  let at = 0;
  for (const r of rows) {
    starts.push(at);
    at += r.text.length + 1;
  }
  return {
    text,
    back: (to: number) => {
      let lo = 0;
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= to) lo = mid;
        else hi = mid - 1;
      }
      const r = rows[lo];
      const off = to - starts[lo];
      return off <= r.lead ? r.at : r.at + (off - r.lead);
    },
  };
}

// callout のアイコンを差し替える。開きタグの icon 属性だけを書き換え、
// 他の属性と中身はそのまま残す。空文字を渡すと属性を落とす。
export function setCalloutIcon(src: string, icon: string): string {
  const lines = src.split("\n");
  const at = lines.findIndex((line) => CONTAINERS.callout.open.test(line.trim()));
  if (at < 0) return src;
  const line = lines[at].trim();
  const pad = indentOf(lines[at]);
  const attrs = (CONTAINERS.callout.open.exec(line)?.[1] ?? "").trim();
  const rest = attrs.replace(/\s*icon="[^"]*"/, "").trim();
  const next = icon ? `icon="${icon}"${rest ? ` ${rest}` : ""}` : rest;
  lines[at] = next ? `${pad}<callout ${next}>` : `${pad}<callout>`;
  return lines.join("\n");
}
