import { BlockSourceEditor } from "./BlockSourceEditor";
import { Icon } from "./Icon";

// 形が崩れていて対応表として読めないフロントマター。
//
// 欄に開けない以上、ここだけは生の字が正しい見せ方になる。黙って隠すと
// 画面から消えたまま直す手立てが無くなるので、読めないことを断って出す。

const SAY = "先頭の情報が読めません（形が崩れています）";

export function BrokenNote({ src }: { src: string }) {
  return (
    <header className="mg-frontmatter mb-8 border-b border-[var(--mg-border)] pb-5">
      <p className="mg-fm-say">
        <Icon name="error" size={14} />
        {SAY}
      </p>
      <pre className="mg-fm-raw">{src.trim()}</pre>
    </header>
  );
}

export function BrokenFields({
  src,
  onCommit,
}: {
  src: string;
  onCommit: (next: string) => void;
}) {
  return (
    <header className="mg-frontmatter mb-8 border-b border-[var(--mg-border)] pb-5">
      <p className="mg-fm-say">
        <Icon name="error" size={14} />
        {SAY}直すと欄になります。
      </p>
      <BlockSourceEditor src={src} onCommit={onCommit} onCancel={() => {}} />
    </header>
  );
}
