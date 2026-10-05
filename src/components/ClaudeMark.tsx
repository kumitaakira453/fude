import claudeMark from "../assets/claude-mark.png";

// Claude のロゴ（光の形）。単色の絵を型抜きにして、文字色で塗る。
// どのテーマでも字と同じ色で馴染み、Icon と同じく size で大きさを決める。
export function ClaudeMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: "currentColor",
        WebkitMaskImage: `url(${claudeMark})`,
        maskImage: `url(${claudeMark})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
