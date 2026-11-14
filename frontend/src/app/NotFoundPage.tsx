import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonClass } from '../components/ui/Button'
import { Icon } from '../components/ui/Icon'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-rule-strong text-faint">
        <Icon name="plan" className="h-7 w-7" />
      </span>
      <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight text-ink">{t('notFound.title')}</h1>
      <Link to="/" className={buttonClass('primary', 'md', 'mt-8')}>
        <Icon name="arrow-left" className="h-4 w-4" /> {t('notFound.back')}
      </Link>
    </div>
  )
}
