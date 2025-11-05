export function AvatarMascot({ size = 120 }) {
  // 目薬ボトルのシンプルSVG
  const body = '#60A5FA';
  const cap = '#1D4ED8';
  const label = '#FFFFFF';
  const drop = '#22D3EE';
  return (
    <div style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" width={size} height={size}>
        {/* 影 */}
        <ellipse cx="100" cy="180" rx="40" ry="8" fill="rgba(0,0,0,0.08)" />

        {/* キャップ */}
        <rect x="78" y="30" width="44" height="26" rx="6" fill={cap} />
        <rect x="82" y="22" width="36" height="12" rx="6" fill={cap} opacity="0.9" />

        {/* ボトル本体 */}
        <rect x="65" y="56" width="70" height="100" rx="16" fill={body} />

        {/* ラベル */}
        <rect x="72" y="88" width="56" height="40" rx="8" fill={label} />
        {/* ラベル内のしずくアイコン */}
        <path d="M100 95 C 92 105, 92 110, 100 118 C 108 110, 108 105, 100 95 Z" fill={drop} />

        {/* ハイライト */}
        <rect x="72" y="60" width="10" height="90" rx="5" fill="#ffffff" opacity="0.25" />
      </svg>
    </div>
  );
}


