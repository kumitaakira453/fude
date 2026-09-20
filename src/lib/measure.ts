// 開発中だけの計測。どこで手が止まっているかを数字で見るための道具で、
// 出来上がりには乗らない（import.meta.env.DEV でしか動かない）。

const on = import.meta.env.DEV;

// メインスレッドが塞がった時間。塞いでいるあいだはタイマーも遅れるので、
// 遅れた分がそのまま「操作を受け付けなかった時間」になる。
export function watchStalls(): void {
  if (!on) return;
  const step = 100;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const late = now - last - step;
    if (late > 150) console.warn(`[塞ぎ] ${Math.round(late)}ms`);
    last = now;
    setTimeout(tick, step);
  };
  setTimeout(tick, step);
}

// 区間の所要。返ってきた関数を呼んだところまでを測る。
export function span(label: string): (note?: string) => void {
  if (!on) return () => {};
  const began = performance.now();
  return (note?: string) => {
    const took = Math.round(performance.now() - began);
    console.info(`[${label}] ${took}ms${note ? ` ${note}` : ""}`);
  };
}
