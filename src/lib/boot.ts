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

// 幕を下ろす。React が反映しただけでは、まだ塗られていないので、2 回先の
// 描画の頭まで待つ。
export function dropBootCurtain(): void {
  const curtain = document.getElementById("boot");
  if (!curtain) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      curtain.classList.add("is-done");
      curtain.addEventListener("transitionend", () => curtain.remove(), { once: true });
      // 動きを止めている環境では transitionend が来ないことがある。
      window.setTimeout(() => curtain.remove(), 500);
    }),
  );
}
