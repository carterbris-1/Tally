interface Props {
  fraction: number
  color: string
  size?: number
  /** A limit that has been blown reads red and full, not "110% complete". */
  exceeded?: boolean
  children?: React.ReactNode
}

export function Ring({ fraction, color, size = 38, exceeded = false, children }: Props) {
  const stroke = size >= 60 ? 5 : 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const shown = exceeded ? 1 : Math.max(0, Math.min(1, fraction))
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={exceeded ? 'var(--bad)' : color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ transition: 'stroke-dashoffset 260ms ease' }}
        />
      </svg>
      {children ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontSize: size >= 60 ? 14 : 11,
            fontWeight: 620,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
