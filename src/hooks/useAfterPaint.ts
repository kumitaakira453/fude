import { useEffect, useState } from "react";

// 値を「画面を 1 枚描き切ってから」受け取る。
//
// 押した手応えと待っている表示を先に出し、重い組み立てはその後に回すために使う。
// 同じ一枚で両方やると、重い側が終わるまで押した側の見た目も変わらない。
//
// requestAnimationFrame は次の描画の直前に呼ばれるので、1 回だけだと画面が
// 出る前に重い処理が始まり、待っている表示が誰の目にも触れない。実際に描かれる
// のを待つには 2 回いる。
// React の割り込み可能な更新（startTransition / useDeferredValue）には頼らない。
// 周りで別の更新が起き続けるかぎり後回しにされ、切り替わらないままになり得る。
export function useAfterPaint<T>(value: T): T | undefined {
  const [shown, setShown] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (shown === value) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(value));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [value, shown]);
  return shown;
}
