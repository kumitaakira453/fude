// Notion から降りてくる md には、行だけのタグで囲まれた塊が空行なしで書かれている。
// CommonMark はこれを 1 つの HTML ブロックとして丸ごと生 HTML に落とすので、中の
// `code` や **強調** が記号のまま出る。
//
// 中身の前後に空行を入れると開きタグの行がそこで閉じ、中身は段落として読まれ、
// rehype-raw が前後の生 HTML と繋ぎ直す。描画に渡す文字列だけを組み替えるので、
// 保存する本文とブロックのオフセットは元のままにできる。

const CALLOUT_OPEN = /^<callout(\s[^>]*)?>$/;
const CALLOUT_CLOSE = "</callout>";
const DETAILS_OPEN = /^<details(\s[^>]*)?>$/;
const DETAILS_CLOSE = "</details>";
const SUMMARY = /^<summary(\s[^>]*)?>.*<\/summary>$/;

function attr(attrs: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : "";
}

// 属性から拾った文字をそのまま埋めると、タグとして解釈される余地が残る。
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 閉じタグの行を探す。入れ子は追わず、最初に見つかったものを対にする。
function closeAt(lines: string[], from: number, close: string): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() === close) return i;
  }
  return -1;
}

export function openHtmlContainers(src: string): string {
  if (!src.includes("<callout") && !src.includes("<details")) return src;

  const lines = src.split("\n");
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const callout = CALLOUT_OPEN.exec(line);
    if (callout) {
      const end = closeAt(lines, i + 1, CALLOUT_CLOSE);
      if (end > 0) {
        const attrs = callout[1] ?? "";
        const icon = escapeText(attr(attrs, "icon"));
        // 色は Notion の名前（gray_bg / blue_bg など）のまま渡し、装飾は CSS で決める。
        const color = /^[a-z_]+$/.test(attr(attrs, "color"))
          ? ` data-color="${attr(attrs, "color")}"`
          : "";
        // 押すとアイコンを選び直せる。目印だけ置き、扱いは描画側に任せる。
        const ico = `<span class="mg-callout-ico" data-mg-callout-ico="1">${icon}</span>`;
        out.push(
          `<div class="mg-callout notion"${color}>${ico}<div class="mg-callout-body">`,
          "",
          ...lines.slice(i + 1, end),
          "",
          "</div></div>",
        );
        changed = true;
        i = end;
        continue;
      }
    }

    const details = DETAILS_OPEN.exec(line);
    if (details) {
      const end = closeAt(lines, i + 1, DETAILS_CLOSE);
      if (end > 0) {
        // 見出し（summary）はタグの直後に置いたままにする。離すと開閉の見出しに
        // ならず、ただの段落になってしまう。
        const head = SUMMARY.test((lines[i + 1] ?? "").trim()) ? i + 2 : i + 1;
        out.push(
          lines[i],
          ...lines.slice(i + 1, head),
          "",
          ...lines.slice(head, end),
          "",
          lines[end],
        );
        changed = true;
        i = end;
        continue;
      }
    }

    out.push(lines[i]);
  }

  return changed ? out.join("\n") : src;
}

// callout のアイコンを差し替える。開きタグの icon 属性だけを書き換え、
// 他の属性と中身はそのまま残す。空文字を渡すと属性を落とす。
export function setCalloutIcon(src: string, icon: string): string {
  const lines = src.split("\n");
  const at = lines.findIndex((line) => CALLOUT_OPEN.test(line.trim()));
  if (at < 0) return src;
  const line = lines[at].trim();
  const attrs = (CALLOUT_OPEN.exec(line)?.[1] ?? "").trim();
  const rest = attrs.replace(/\s*icon="[^"]*"/, "").trim();
  const next = icon ? `icon="${icon}"${rest ? ` ${rest}` : ""}` : rest;
  lines[at] = next ? `<callout ${next}>` : "<callout>";
  return lines.join("\n");
}
