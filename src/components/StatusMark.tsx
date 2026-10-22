import { useAtomValue } from "jotai";
import { PHASE_LABEL, type Phase } from "../lib/claude";
import { spinStatusAtom } from "../state/atoms";

// Claude のセッションの状態の印。作業中は回る輪（設定で止められる）、返事待ちは
// 点、終わったものは空の丸。待機中・不明・消えたものには付けない。
export const MARKED: Partial<Record<Phase, "working" | "waiting" | "done">> = {
  working: "working",
  waiting: "waiting",
  done: "done",
  ended: "done",
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

