/** Shared button styling for <button> and <Link>/<a> (one source of truth, no wrapper components). */
type Variant = 'primary' | 'secondary' | 'ghost' | 'zest' | 'inverse'
type Size = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-soft shadow-soft',
  zest: 'bg-zest-400 text-ink hover:bg-zest-300 shadow-soft',
  secondary: 'bg-card text-ink ring-1 ring-rule-strong ring-inset hover:bg-paper-deep/60',
  ghost: 'text-jade-700 hover:bg-jade-50',
  inverse: 'bg-paper/10 text-paper ring-1 ring-paper/20 ring-inset hover:bg-paper/20',
}
const SIZES: Record<Size, string> = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim()
}
