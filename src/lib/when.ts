// いつの話か。指摘とその返信は「何分前・何日前」で読むほうが、絶対時刻より
// 判断に効く（自分が書いたものより後の返事かどうかが一目で分かる）。

const short = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function whenText(at: number): string {
  return short.format(at);
}

// 古い指摘が古いと一目で分かる言い方。1 週間を超えたら日時に切り替える
// （「38 日前」は数え直さないと日付にならない）。
export function ago(at: number, now = Date.now()): string {
  const min = (now - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  if (min < 60 * 24 * 7) return `${Math.floor(min / 60 / 24)} 日前`;
  return whenText(at);
}
