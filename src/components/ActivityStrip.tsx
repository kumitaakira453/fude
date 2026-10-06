import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { claudeLinkAtom, sidebarOpenAtom, sidebarTabAtom, type SideFace } from "../state/atoms";
import { draftRelAtom } from "../state/drafts";
import { openTotalAtom, reviewScreenAtom } from "../state/review";
import { IconBtn } from "./Chrome";
import { ClaudeMark } from "./ClaudeMark";

// 左端の縦の帯。左の欄に出す面（ファイル・検索・Claude）を切り替える。
// 今出している面をもう一度押すと、左の欄を閉じる。下にはコメント一覧の入口。
const FACES: { id: SideFace; tip: string; icon: string; keys?: string }[] = [
  { id: "files", tip: "ファイル", icon: "description" },
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
          size={18}
          on={open && face === f.id}
          onClick={() => pick(f.id)}
        />
      ))}
      {claude && (
        <button
          type="button"
          data-tip="Claude のセッション"
          aria-label="Claude のセッション"
          aria-pressed={open && face === "claude"}
          className={`mg-ibtn${open && face === "claude" ? " is-on" : ""}`}
          onClick={() => pick("claude")}
        >
          <ClaudeMark size={16} />
        </button>
      )}
      <span className="mg-strip-gap" />
      <span className="mg-strip-badge-host">
        <IconBtn
          tip={isDraft ? "コメントは保存先を決めてから" : "コメント一覧（全ファイル）"}
          keys="⌘⇧R"
          icon="forum"
          size={18}
          disabled={isDraft}
          onClick={() => setReview(true)}
        />
        {openTotal > 0 && !isDraft && <span className="mg-strip-badge">{openTotal}</span>}
      </span>
    </nav>
  );
}
