import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { claudeLinkAtom, sidebarOpenAtom, sidebarTabAtom, type SideFace } from "../state/atoms";
import { draftRelAtom } from "../state/drafts";
import { openTotalAtom, reviewScreenAtom } from "../state/review";
import { IconBtn } from "./Chrome";

// 左端の縦の帯。左の欄に出す面（ファイル・検索・Claude）を切り替える。
// 今出している面をもう一度押すと、左の欄を閉じる。続けてコメント一覧の入口。
const FACES: { id: SideFace; tip: string; icon: string; keys?: string }[] = [
  { id: "files", tip: "ファイル", icon: "insert_drive_file" },
  { id: "search", tip: "全文を検索", icon: "search", keys: "⌘⇧F" },
];

export function ActivityStrip() {
  const [face, setFace] = useAtom(sidebarTabAtom);
  const [open, setOpen] = useAtom(sidebarOpenAtom);
  const claude = useAtomValue(claudeLinkAtom);
  const openTotal = useAtomValue(openTotalAtom);
  const isDraft = useAtomValue(draftRelAtom) !== null;
  const setReview = useSetAtom(reviewScreenAtom);

  const pick = (id: SideFace) => {
    if (open && face === id) {
      setOpen(false);
      return;
    }
    setFace(id);
    setOpen(true);
  };

  return (
    <nav className="mg-strip" aria-label="左の欄">
      {FACES.map((f) => (
        <IconBtn
          key={f.id}
          tip={f.tip}
          keys={f.keys}
          icon={f.icon}
          on={open && face === f.id}
          onClick={() => pick(f.id)}
        />
      ))}
      {claude && (
        <IconBtn
          tip="Claude のセッション"
          icon="claude"
          on={open && face === "claude"}
          onClick={() => pick("claude")}
        />
      )}
      {/* 未解決があることは点だけで示し、数は吹き出しで出す。数字の札は釦の外へ
          はみ出して、帯の中で浮いて見える。 */}
      <span className="mg-strip-dot-host">
        <IconBtn
          tip={
            isDraft
              ? "コメントは保存先を決めてから"
              : openTotal > 0
                ? `コメント一覧（全ファイル）・未解決 ${openTotal} 件`
                : "コメント一覧（全ファイル）"
          }
          keys="⌘⇧R"
          icon="comment"
          disabled={isDraft}
          onClick={() => setReview(true)}
        />
        {openTotal > 0 && !isDraft && <span className="mg-strip-dot" aria-hidden />}
      </span>
    </nav>
  );
}
