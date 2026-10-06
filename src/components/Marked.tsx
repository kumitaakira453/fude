// 名前で探す一覧の行で、打った語に当たった部分を強める。語は空白で区切ったそれぞれを見る。
export function Marked({ text, query }: { text: string; query: string }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return <>{text}</>;
  const low = text.toLowerCase();
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let at = low.indexOf(w); at >= 0; at = low.indexOf(w, at + 1)) {
      for (let i = at; i < at + w.length; i++) hit[i] = true;
    }
  }
  const parts: { s: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.on === hit[i]) last.s += text[i];
    else parts.push({ s: text[i], on: hit[i] });
  }
  return (
    <>
      {parts.map((p, i) => (p.on ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}
    </>
  );
}
