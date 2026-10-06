// 起動の幕（index.html の #boot）。
//
// 画面は最初、フォルダの履歴を読む前の空の状態で描かれ、前回の続きはその後に
// 開き直される。本文はさらにその後で読まれる。幕はその間の画面を隠しておき、
// 前回の本文が描けてから下ろす。

let shown: () => void = () => {};
const shownOnce = new Promise<void>((resolve) => {
  shown = resolve;
});

// 本文の面が中身を描き終えた（骨組みが外れた）。最初の 1 回だけが意味を持つ。
export function markDocShown(): void {
  shown();
}

export const whenDocShown = (): Promise<void> => shownOnce;

// 幕が下りきるまでの時間（index.html の #boot.is-done と合わせる）。
const LEAVE_MS = 420;

// 字の並びの外枠（余白を含まない、書かれている字そのものの箱）。
function textBox(el: Element): DOMRect | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const box = range.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
}

// 幕の「fude」を、画面の中の同じ字（ツールバーやスタート画面の名前）の位置へ
// 動かしながら下ろす。そのまま薄くすると、真ん中の字が消えるのと同時に左上の
// 同じ字が現れ、字が左上へ跳んだように見える。動かして重ねれば、1 つの字が
// 持ち場へ収まったように見える。
function flyToWordmark(curtain: HTMLElement): void {
  const word = curtain.querySelector<HTMLElement>(".boot-word");
  const target = document.querySelector(".mg-wordmark");
  if (!word || !target) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // 現れている途中の形（字の途中で切れた見え方）から動かさない。現れ終えた形で止める。
  curtain.classList.add("is-landing");
  const from = textBox(word);
  const to = textBox(target);
  if (!from || !to) return;
  const scale = to.height / from.height;
  const box = word.getBoundingClientRect();
  word.style.transformOrigin = `${from.left - box.left}px ${from.top - box.top}px`;
  word.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`;
}

// 幕を下ろす。React が反映しただけでは、まだ塗られていないので、2 回先の
// 描画の頭まで待つ。
export function dropBootCurtain(): void {
  const curtain = document.getElementById("boot");
  if (!curtain) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      flyToWordmark(curtain);
      curtain.classList.add("is-done");
      // 動きを止めている環境では transitionend が来ないことがある。時間で外す。
      window.setTimeout(() => curtain.remove(), LEAVE_MS + 80);
    }),
  );
}
