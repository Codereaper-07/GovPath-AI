import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n/config'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  return (
    <label className="flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
      <span>{t('language.label')}</span>
      <select
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-medium text-slate-800 hover:border-slate-300 focus:border-brand-500"
        value={i18n.resolvedLanguage}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
