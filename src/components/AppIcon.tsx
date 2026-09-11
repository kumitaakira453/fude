import mark from "../assets/mark.png";

// アプリの印（筆）。ドックのアイコンから地のクリーム色を落とし、かたちだけを
// 抜いたもの。切り抜きとして使って色は currentColor から取るので、どの配色でも
// その配色の色で出る（クリーム色の四角のまま置くと、地色によって浮く）。
export function AppIcon({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`mg-app-icon ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${mark})`,
        maskImage: `url(${mark})`,
      }}
    />
  );
}
