// 素の入力欄で Markdown を書くための手当て。DOM には触らず、字と位置だけを
// 受け取って次の字と位置を返す。当てる側（useMarkdownKeys）が入力欄へ渡す。

export interface Edit {
  value: string;
  // 当てた後に選ぶ範囲。同じ値なら、そこにキャレットを置く。
  start: number;
  end: number;
}

// 行頭の記号。番号・チェックはそれぞれ次の行へ引き継ぐときに作り直す。
const ITEM = /^([ \t]*)(?:([-*+])|(\d+)([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
const QUOTE = /^([ \t]*>[ \t]?)/;

// 改行を押したときの続き。行頭の記号を次の行へ引き継ぐ。
// 記号だけの行なら記号を落として、そこでリストを終える。
// 引き継ぐものが無い行では null を返し、素の改行に任せる。
export function continueList(value: string, at: number): Edit | null {
  const ls = value.lastIndexOf("\n", at - 1) + 1;
  const head = value.slice(ls, at);

  const item = ITEM.exec(head);
  if (item) {
    const rest = head.slice(item[0].length);
    if (!rest.trim()) return strip(value, ls, at);
    const box = item[6] ? "[ ] " : "";
    const mark = item[2]
      ? `${item[1]}${item[2]}${item[5]}${box}`
      : `${item[1]}${Number(item[3]) + 1}${item[4]}${item[5]}${box}`;
    return insert(value, at, `\n${mark}`);
  }

  const quote = QUOTE.exec(head);
  if (quote) {
    if (!head.slice(quote[0].length).trim()) return strip(value, ls, at);
    return insert(value, at, `\n${quote[1]}`);
  }

  return null;
}

// 選んだところを記号で囲む。すでに囲まれていれば外す。
// 選んでいないときは記号だけ置いて、その間にキャレットを送る。
export function wrapWith(
  value: string,
  start: number,
  end: number,
  mark: string,
): Edit {
  const n = mark.length;
  if (start === end) {
    return {
      value: value.slice(0, start) + mark + mark + value.slice(start),
      start: start + n,
      end: start + n,
    };
  }
  const sel = value.slice(start, end);
  // 内側に記号を含んだまま選ばれていることもある（言葉ごと選び直したとき）。
  if (sel.length > n * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const bare = sel.slice(n, -n);
    return {
      value: value.slice(0, start) + bare + value.slice(end),
      start,
      end: start + bare.length,
    };
  }
  if (
    value.slice(Math.max(0, start - n), start) === mark &&
    value.slice(end, end + n) === mark
  ) {
    return {
      value: value.slice(0, start - n) + sel + value.slice(end + n),
      start: start - n,
      end: end - n,
    };
  }
  return {
    value: value.slice(0, start) + mark + sel + mark + value.slice(end),
    start: start + n,
    end: end + n,
  };
}

// 選んだところをリンクにする。行き先を選んだ状態で返し、そのまま貼り付けられる
// ようにする。URL を選んでいたときは、代わりに見出しの側を選ぶ。
const PLACE = "url";

export function linkAt(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end);
  if (/^(https?:\/\/|mailto:)\S*$/.test(sel)) {
    return {
      value: `${value.slice(0, start)}[](${sel})${value.slice(end)}`,
      start: start + 1,
      end: start + 1,
    };
  }
  const text = `[${sel}](${PLACE})`;
  const from = start + sel.length + 3;
  return {
    value: value.slice(0, start) + text + value.slice(end),
    start: from,
    end: from + PLACE.length,
  };
}

// 行頭の記号を落として空の行にする。
function strip(value: string, ls: number, at: number): Edit {
  return { value: value.slice(0, ls) + value.slice(at), start: ls, end: ls };
}

function insert(value: string, at: number, text: string): Edit {
  const to = at + text.length;
  return { value: value.slice(0, at) + text + value.slice(at), start: to, end: to };
}
