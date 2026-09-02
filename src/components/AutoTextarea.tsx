import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// 中身に合わせて高さが伸びる入力欄。行数を固定すると、書いている途中の文が
// 枠の外へ隠れて読み返せない。上限まで伸びたところで初めてスクロールに任せる。

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "rows"
> & {
  value: string;
  minRows?: number;
  maxRows?: number;
};

export function AutoTextarea({
  value,
  minRows = 2,
  maxRows = 14,
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // まず縮めてから測る。伸びたままだと scrollHeight が前の高さを引きずる。
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 18;
    const inside =
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth);
    const min = line * minRows + inside;
    const max = line * maxRows + inside;
    // scrollHeight は枠線を含まないので足す（box-sizing: border-box）。
    const want = el.scrollHeight + parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth);
    el.style.height = `${Math.round(Math.min(max, Math.max(min, want)))}px`;
    el.style.overflowY = want > max ? "auto" : "hidden";
  }, [value, minRows, maxRows]);

  return <textarea ref={ref} value={value} rows={minRows} {...rest} />;
}
