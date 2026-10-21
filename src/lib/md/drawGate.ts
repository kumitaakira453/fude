// 編集面で図を描き直す間合い。
//
// 打つのが止まってから描く。変換中（IME）は描かない。描けなかったときのエラーは、
// しばらく同じ記述のままだったときだけ出す。IME の確定で書きかけの行が入った瞬間や、
// 打っている途中の記述でエラーが出入りすると、エラーの段と図が上下に跳ねてちらつく。

export interface DrawGate {
  // 記述が変わった。now は待たずに描く（明暗の切り替えなど）。
  draw(code: string, now?: boolean): void;
  stop(): void;
}

export function drawGate(opts: {
  render: (code: string) => Promise<string>;
  onSvg: (svg: string) => void;
  onError: (message: string) => void;
  // 変換中か。変換中は描き直しを先へ送る。
  composing: () => boolean;
  delay: number;
  errorDelay: number;
}): DrawGate {
  let timer = 0;
  let errorTimer = 0;
  let seq = 0;
  let dead = false;

  const run = (code: string) => {
    if (opts.composing()) {
      timer = window.setTimeout(() => run(code), opts.delay);
      return;
    }
    const token = ++seq;
    opts.render(code).then(
      (svg) => {
        if (dead || token !== seq) return;
        window.clearTimeout(errorTimer);
        opts.onSvg(svg);
      },
      (e: { message?: string }) => {
        if (dead || token !== seq) return;
        const message = String(e?.message || e);
        window.clearTimeout(errorTimer);
        errorTimer = window.setTimeout(() => {
          if (!dead && token === seq) opts.onError(message);
        }, opts.errorDelay);
      },
    );
  };

  return {
    draw(code, now = false) {
      window.clearTimeout(timer);
      // 記述が変わったら、出そうとしていたエラーは古い。
      window.clearTimeout(errorTimer);
      seq++;
      if (now) run(code);
      else timer = window.setTimeout(() => run(code), opts.delay);
    },
    stop() {
      dead = true;
      window.clearTimeout(timer);
      window.clearTimeout(errorTimer);
    },
  };
}
