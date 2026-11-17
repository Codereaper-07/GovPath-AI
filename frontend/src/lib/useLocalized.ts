import { useTranslation } from 'react-i18next'
import { DOCUMENT_DESCRIPTIONS_HI } from '../i18n/documentDescriptions.hi'

/** Returns a picker that chooses the Hindi value when the UI is in Hindi and one exists. */
export function useLocalized() {
  const { i18n } = useTranslation()
  const hindi = i18n.resolvedLanguage === 'hi'
  return (en: string, hi: string | null | undefined): string => (hindi && hi ? hi : en)
}

/**
 * Returns a picker for a document type's explanatory description (GovPath's own text, never an
 * official quote). English: the API's description, unchanged. Hindi: the curated translation, but
 * only while the API still returns the exact English it was made from; otherwise the English.
 */
export function useDocumentDescription() {
  const { i18n } = useTranslation()
  const hindi = i18n.resolvedLanguage === 'hi'
  return (id: string, english: string | null | undefined): { text: string; lang: 'en' | 'hi' } | null => {
    if (!english) return null
    const hi = hindi ? DOCUMENT_DESCRIPTIONS_HI[id] : undefined
    return hi && hi.en === english ? { text: hi.hi, lang: 'hi' } : { text: english, lang: 'en' }
  }
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
