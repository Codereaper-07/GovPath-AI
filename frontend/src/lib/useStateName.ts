import { useTranslation } from 'react-i18next'

/** Display name of a state/UT in the current language. The canonical English name stays the
 * value everywhere (API, database, planner); only the label is localized. */
export function useStateName() {
  const { t } = useTranslation()
  return (state: string | null | undefined) => (state ? t(`stateNames.${state}`, { defaultValue: state }) : '')
}
