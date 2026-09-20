// 操作の種別ごとの色。テーマの変数から引くので、配色を変えても付いてくる。
//
// 並んだ項目がすべて同じ色だと、作るのも消すのも見分けが付かない。危ないものと
// 増やすものだけは、字を読む前に目で分かるようにする。

export type Tone = "make" | "drop" | "open" | "edit";

export const TONE_COLOR: Record<Tone, string> = {
  make: "var(--mg-add-fg)",
  drop: "var(--mg-danger)",
  open: "var(--mg-accent)",
  edit: "var(--mg-accent2)",
};

// 種別を持たないものは控えめに。写す・閉じるのように、どちらへも転ばない操作。
export const toneColor = (tone?: Tone): string =>
  tone ? TONE_COLOR[tone] : "var(--mg-muted)";
