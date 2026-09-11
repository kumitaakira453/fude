import { openUrl } from "@tauri-apps/plugin-opener";

// メタ情報の値の種類。
//
// 種類は後から増える前提で、表 1 つにまとめてある。足すときはここに 1 行足す。
// 見分けは上から順に当てるので、狭いものを先に置く。

export interface Kind {
  id: string;
  icon: string;
  // 値の字がこの種類か。
  match: (text: string) => boolean;
  // 値の脇に出す操作。無ければ出さない。押すのは釦で、値そのものは打つための欄。
  act?: { icon: string; title: string; run: (text: string) => void };
}

const URL_RE = /^https?:\/\/\S+$/i;
const MAIL_RE = /^(?:mailto:)?[^\s@]+@[^\s@]+\.[^\s@.]+$/;
// 日付。時刻や時差が付いていてもよい。月日の範囲まで見て、2026-13-45 を拾わない。
const DATE_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;

const TEXT: Kind = { id: "text", icon: "text_fields", match: () => true };

// 値が「- 項目」の並びのときに使う。字からは見分けられないので、行の側で指す。
export const LIST: Kind = { id: "list", icon: "list", match: () => false };

export const KINDS: Kind[] = [
  {
    id: "url",
    icon: "link",
    match: (t) => URL_RE.test(t),
    act: {
      icon: "open_in_new",
      title: "開く",
      run: (t) => void openUrl(t),
    },
  },
  {
    id: "mail",
    icon: "mail",
    match: (t) => MAIL_RE.test(t),
    act: {
      icon: "open_in_new",
      title: "送る",
      run: (t) => void openUrl(t.startsWith("mailto:") ? t : `mailto:${t}`),
    },
  },
  { id: "date", icon: "calendar_today", match: (t) => DATE_RE.test(t) },
  { id: "bool", icon: "toggle_on", match: (t) => t === "true" || t === "false" },
  { id: "number", icon: "numbers", match: (t) => NUM_RE.test(t) },
  TEXT,
];

export function kindOf(text: string): Kind {
  const one = text.trim();
  return KINDS.find((k) => k.match(one)) ?? TEXT;
}
