import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import { useLocalized } from '../../lib/useLocalized'
import type { ApiErrorDetail, AssistantAnswer } from '../../types/api'
import { readSavedPlan } from '../planner/usePlannerState'
import { useServices } from '../services/api'
import { AnswerCard } from './AnswerCard'
import { useAskAssistant } from './api'

const MAX_CHARS = 1000
const EXAMPLES = ['example1', 'example2', 'example3'] as const

interface Exchange {
  id: number
  question: string
  answer: AssistantAnswer
}

function errorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'assistant.error.generic'
  if (error.status === 0) return 'common.networkError'
  const code = (error.detail as ApiErrorDetail | undefined)?.code
  const known = [
    'quota_exhausted',
    'rate_limited',
    'assistant_not_configured',
    'index_not_built',
    'model_unavailable',
    'model_error',
    'unknown_ids',
  ]
  if (code && known.includes(code)) return `assistant.error.${code}`
  if (error.status === 422) return 'assistant.error.validation'
  return 'assistant.error.generic'
}

export function AssistantPage() {
  const { t, i18n } = useTranslation()
  const pick = useLocalized()
  const services = useServices()
  const ask = useAskAssistant()
  const [question, setQuestion] = useState('')
  const [usePlan, setUsePlan] = useState(true)
  const [history, setHistory] = useState<Exchange[]>([])

  const saved = readSavedPlan()
  const hasPlan = saved.generated && saved.targets.length > 0
  const serviceName = (id: string) => {
    const s = services.data?.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }

  const submit = (text: string) => {
    const q = text.trim()
    if (q.length < 3 || ask.isPending) return
    const language = i18n.resolvedLanguage === 'hi' ? 'hi' : 'en'
    ask.mutate(
      {
        question: q,
        language,
        ...(usePlan && hasPlan
          ? {
              workflow: {
                target_service_ids: saved.targets,
                owned_document_ids: saved.owned,
                completed_service_ids: saved.completed,
              },
            }
          : {}),
      },
      {
        onSuccess: (answer) => {
          setHistory((h) => [{ id: Date.now(), question: q, answer }, ...h])
          setQuestion('')
        },
      },
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(question)
  }

  return (
    <>
      <PageHeader title={t('assistant.title')}>{t('assistant.intro')}</PageHeader>

      <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label htmlFor="assistant-question" className="text-sm font-semibold text-slate-900">
          {t('assistant.questionLabel')}
        </label>
        <textarea
          id="assistant-question"
          value={question}
          maxLength={MAX_CHARS}
          rows={3}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(question)
          }}
          placeholder={t('assistant.placeholder')}
          className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-brand-600 focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{t('assistant.chars', { count: question.length, max: MAX_CHARS })}</span>
          {hasPlan && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={usePlan}
                onChange={(e) => setUsePlan(e.target.checked)}
              />
              {t('assistant.usePlan')}
            </label>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={question.trim().length < 3 || ask.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {ask.isPending ? t('assistant.thinking') : t('assistant.ask')}
          </button>
          {EXAMPLES.map((k) => (
            <button
              key={k}
              type="button"
              disabled={ask.isPending}
              onClick={() => {
                setQuestion(t(`assistant.${k}`))
                submit(t(`assistant.${k}`))
              }}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
            >
              {t(`assistant.${k}`)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">{t('assistant.quotaNote')}</p>
      </form>

      <div className="mt-6 space-y-6" aria-live="polite">
        {ask.isPending && (
          <div role="status" className="flex items-center gap-3 text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
            {t('assistant.searching')}
          </div>
        )}
        {ask.isError && <ErrorState message={t(errorKey(ask.error))} />}
        {history.length === 0 && !ask.isPending && !ask.isError && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            {t('assistant.empty')}
          </p>
        )}
        {history.map((ex) => (
          <div key={ex.id} className="space-y-2">
            <p className="ml-auto max-w-[90%] rounded-xl bg-brand-600 px-4 py-2 text-sm text-white sm:max-w-[70%]">
              {ex.question}
            </p>
            <AnswerCard answer={ex.answer} prefix={`a${ex.id}`} serviceName={serviceName} />
          </div>
        ))}
      </div>
    </>
  )
}
