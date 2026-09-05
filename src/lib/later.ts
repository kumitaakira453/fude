// 打鍵が途切れてから動かす。打ち続けている間も、上限ごとに 1 回は流す。
//
// 打鍵のたびに重い処理（本文全体の組み直しと保存）を走らせると引っかかる。
// かといって途切れるまで待つだけだと、長く打ち続けている間ずっと保存されない。
// 「手を止めたら流す」と「止めなくても定期に流す」を両方持つ。

export interface Throttled {
  (): void;
  // 待たずに今すぐ流す。予約が無ければ何もしない。
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export function throttled(run: () => void, wait: number, cap: number): Throttled {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 最初に頼まれた時刻。上限はここから数える。
  let since = 0;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const fire = () => {
    stop();
    since = 0;
    run();
  };

  const ask = () => {
    const now = Date.now();
    if (!since) since = now;
    const left = cap - (now - since);
    if (left <= 0) {
      fire();
      return;
    }
    stop();
    timer = setTimeout(fire, Math.min(wait, left));
  };

  return Object.assign(ask, {
    flush: () => {
      if (timer !== null) fire();
    },
    cancel: () => {
      stop();
      since = 0;
    },
    pending: () => timer !== null,
  });
}
