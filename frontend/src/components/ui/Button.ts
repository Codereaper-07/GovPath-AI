/** Shared button styling for <button> and <Link>/<a> (one source of truth, no wrapper components). */
type Variant = 'primary' | 'secondary' | 'ghost' | 'accent'
type Size = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white shadow-card hover:bg-brand-800',
  accent: 'bg-accent-600 text-white shadow-card hover:bg-accent-700',
  secondary: 'bg-surface text-slate-800 ring-1 ring-line ring-inset hover:bg-slate-50',
  ghost: 'text-brand-700 hover:bg-brand-50',
}
const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim()
}
