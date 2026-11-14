import { useTranslation } from 'react-i18next'

/** Returns a picker that chooses the Hindi value when the UI is in Hindi and one exists. */
export function useLocalized() {
  const { i18n } = useTranslation()
  const hindi = i18n.resolvedLanguage === 'hi'
  return (en: string, hi: string | null | undefined): string => (hindi && hi ? hi : en)
}

export function useFormatDate() {
  const { i18n } = useTranslation()
  return (iso: string | null | undefined) =>
    iso
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage === 'hi' ? 'hi-IN' : 'en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(new Date(iso))
      : ''
}
