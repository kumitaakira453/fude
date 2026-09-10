// 本文が出るまでの骨組み。
//
// 読み込み中の言葉ではなく、これから出る本文の形を先に置く。待っている間の
// 画面が本文と同じ格好をしているほうが、切り替わりが跳ねない。
export function LoadingBody() {
  const widths = ["45%", "100%", "92%", "78%", "100%", "88%", "60%"];
  return (
    <div className="mg-skeleton" aria-label="読み込み中" aria-busy>
      {widths.map((w, i) => (
        <div
          key={i}
          className={`mg-skeleton-bar${i === 0 ? " mg-skeleton-head" : ""}`}
          style={{ width: w }}
        />
      ))}
    </div>
  );
}
