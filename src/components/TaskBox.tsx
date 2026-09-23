import { markBody } from "../lib/md/taskMarks";

// タスクの印。書いた字がそのまま四角の中に出る（`[/]` なら斜めの線、`[>]` なら
// 右向き）。絵の形は 1 か所（lib/md/taskMarks.ts）に置いてあり、読む面・編集面・
// 設定・メニューがこれを通す。
//
// 合字の書体ではなく形で持つのは、書き出した 1 枚をそのまま渡せるようにするため。
// 書体を持っていない相手の画面では、合字は英単語として出る。
export function TaskBox({ mark, size = 20 }: { mark: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mg-task-box"
      dangerouslySetInnerHTML={{ __html: markBody(mark) }}
    />
  );
}
