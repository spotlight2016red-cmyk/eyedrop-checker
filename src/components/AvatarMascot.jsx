export function AvatarMascot({ size = 120 }) {
  const color = { primary: '#3B82F6', secondary: '#22D3EE', accent: '#60A5FA' };
  return (
    <div style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <linearGradient id="grad-mascot" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color.primary} />
            <stop offset="100%" stopColor={color.secondary} />
          </linearGradient>
        </defs>
        <ellipse cx="100" cy="140" rx="35" ry="45" fill="url(#grad-mascot)" />
        <circle cx="100" cy="70" r="30" fill={color.primary} />
        <circle cx="92" cy="65" r="3" fill="white" />
        <circle cx="108" cy="65" r="3" fill="white" />
        <path d="M 92 78 Q 100 82 108 78" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="70" cy="130" rx="12" ry="35" fill={color.accent} transform="rotate(-20 70 130)" />
        <ellipse cx="130" cy="130" rx="12" ry="35" fill={color.accent} transform="rotate(20 130 130)" />
        <ellipse cx="85" cy="180" rx="10" ry="25" fill={color.primary} />
        <ellipse cx="115" cy="180" rx="10" ry="25" fill={color.primary} />
        <circle cx="125" cy="125" r="12" fill="white" stroke={color.primary} strokeWidth="2" />
        <circle cx="125" cy="125" r="2" fill={color.primary} />
        <line x1="125" y1="125" x2="125" y2="117" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="125" y1="125" x2="125" y2="133" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" />
        <path d="M 70 55 L 100 40 L 130 55 Z" fill={color.secondary} />
        <ellipse cx="100" cy="55" rx="30" ry="5" fill={color.accent} />
      </svg>
    </div>
  );
}


