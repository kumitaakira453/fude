import { isAgent, type ReviewThread } from "./review";

// コメントの種類。人が AI に何を頼むかを、本文の頭の印（[edit] など）で持つ。
// 台帳の形は変えないので、fude review list とレビュー対応のスキルがそのまま読める。
//
// 印が無いものは修正として扱う。承認は AI の返信（答え・案）を受けて付けるので、
// 返信にだけ付けられる。

export type CommentKind = "edit" | "ask" | "ideas" | "approve";

export interface KindInfo {
  id: CommentKind;
  name: string;
  // 返信にだけ付けられるか。
  replyOnly?: boolean;
}

export const KINDS: KindInfo[] = [
  { id: "edit", name: "修正" },
  { id: "ask", name: "質問" },
  { id: "ideas", name: "案出し" },
  { id: "approve", name: "承認", replyOnly: true },
];

export const kindName = (kind: CommentKind): string => KINDS.find((k) => k.id === kind)?.name ?? kind;

// 頭の印。大文字・小文字と全角の［］、前後の空白は区別しない。4 つ以外の印
// （[仕様調整] など）は種類として読まず、本文のまま残す。
const HEAD = /^\s*[[［]\s*([a-zA-Z]+)\s*[\]］]\s*/;

export function kindOf(body: string): { kind: CommentKind | null; rest: string } {
  const m = HEAD.exec(body);
  const id = m?.[1].toLowerCase();
  const kind = KINDS.find((k) => k.id === id)?.id ?? null;
  return kind && m ? { kind, rest: body.slice(m[0].length) } : { kind: null, rest: body };
}

export function withKind(kind: CommentKind | null, text: string): string {
  const { rest } = kindOf(text);
  return kind ? `[${kind}] ${rest}` : rest;
}

// スレッドの種類。人の書き込みのうち、最後に種類を付けたもの。どこにも無ければ修正。
export function threadKind(thread: Pick<ReviewThread, "comments">): CommentKind {
  for (let i = thread.comments.length - 1; i >= 0; i--) {
    const c = thread.comments[i];
    if (isAgent(c.author)) continue;
    const { kind } = kindOf(c.body);
    if (kind) return kind;
  }
  return "edit";
}
