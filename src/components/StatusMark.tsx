import { useAtomValue } from "jotai";
import { PHASE_LABEL, type Phase } from "../lib/claude";
import { spinStatusAtom } from "../state/atoms";

// Claude のセッションの状態の印。作業中は回る輪（設定で止められる）、返事待ちは
// 点、終わったものは空の丸。待機中・不明・消えたものには付けない。
// ended（一覧から外れ、再開に resume が要る）と deleted（記録も無い）は、仕事を
// 終えただけの done と見分けられるよう、別の印（斜線の丸）にする。
export const MARKED: Partial<Record<Phase, "working" | "waiting" | "done" | "gone">> = {
  working: "working",
  waiting: "waiting",
  done: "done",
  ended: "gone",
  deleted: "gone",
};

export function StatusMark({ phase }: { phase: Phase | null }) {
  const spin = useAtomValue(spinStatusAtom);
  const mark = phase ? MARKED[phase] : undefined;
  if (!mark) return null;
  return (
    <i
      className={`mg-st is-${mark}${mark === "working" && !spin ? " is-still" : ""}`}
      aria-label={phase ? PHASE_LABEL[phase] : undefined}
    />
  );
}

