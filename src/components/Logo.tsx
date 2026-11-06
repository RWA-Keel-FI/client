/** Keel mark: a K whose stem is a keel fin, with arms deviating above and below the reference line.
 *  Single colour, inherits `currentColor`. Source of truth for the artwork is public/logo-glyph.svg. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size * (45 / 51)} height={size} viewBox="11 7 45 51" fill="currentColor" aria-hidden="true">
      <path d="M12 9h10v47l-10-8z" />
      <path d="M22 29 37 9h11L33 29z" />
      <path d="M22 29 37 49h11L33 29z" />
      <rect x="37.5" y="27.9" width="16.5" height="2.2" rx="1.1" fillOpacity=".55" />
    </svg>
  )
}
