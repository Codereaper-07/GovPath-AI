import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n/config'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{t('language.label')}</span>
      <span aria-hidden className="pointer-events-none absolute left-3 font-display text-sm text-jade-700">अ</span>
      <select
        className="appearance-none rounded-full border border-rule-strong bg-card py-1.5 pr-7 pl-8 text-sm font-semibold text-ink transition hover:border-ink focus:border-ink"
        value={i18n.resolvedLanguage}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-3 h-3 w-3 text-muted"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </label>
  )
}
