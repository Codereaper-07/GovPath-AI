import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
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
const EXAMPLES = ['example1', 'example2', 'example3', 'example4', 'example5'] as const

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
  const [params] = useSearchParams()
  const [question, setQuestion] = useState(() => params.get('q') ?? '')
  const [usePlan, setUsePlan] = useState(true)
  const [history, setHistory] = useState<Exchange[]>([])
  const [lastQuestion, setLastQuestion] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const saved = readSavedPlan()
  const hasPlan = saved.generated && saved.targets.length > 0
  const serviceName = (id: string) => {
    const s = services.data?.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [history.length, ask.isPending])

  const submit = (text: string) => {
    const q = text.trim()
    if (q.length < 3 || ask.isPending) return
    setLastQuestion(q)
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
          setHistory((h) => [...h, { id: Date.now(), question: q, answer }])
          setQuestion('')
        },
      },
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(question)
  }

  const empty = history.length === 0 && !ask.isPending && !ask.isError

  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col">
      <PageHeader eyebrow={t('assistant.eyebrow')} title={t('assistant.title')}>
        {t('assistant.intro')}
      </PageHeader>

      <div className="flex-1 space-y-8" aria-live="polite">
        {empty && (
          <section className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-ai"><Icon name="spark" /></span>
              <div>
                <p className="font-display text-xl font-semibold text-slate-900">{t('assistant.welcomeTitle')}</p>
                <p className="text-sm text-slate-600">{t('assistant.empty')}</p>
              </div>
            </div>
            <p className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">{t('assistant.tryAsking')}</p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {EXAMPLES.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    disabled={ask.isPending}
                    onClick={() => {
                      setQuestion(t(`assistant.${k}`))
                      submit(t(`assistant.${k}`))
                    }}
                    className="flex h-full w-full items-start gap-2 rounded-xl border border-line bg-canvas p-4 text-left text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/50 hover:text-slate-900"
                  >
                    <Icon name="chat" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    {t(`assistant.${k}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {history.map((ex) => (
          <div key={ex.id} className="space-y-3">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-800 px-4 py-2.5 text-sm text-white shadow-card sm:max-w-[70%]">{ex.question}</p>
            </div>
            <div className="flex gap-3">
              <span className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-ai sm:flex" aria-hidden>
                <Icon name="spark" className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <AnswerCard answer={ex.answer} prefix={`a${ex.id}`} serviceName={serviceName} />
              </div>
            </div>
          </div>
        ))}

        {ask.isPending && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-800/90 px-4 py-2.5 text-sm text-white sm:max-w-[70%]">{lastQuestion}</p>
            </div>
            <div role="status" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-slate-500 shadow-card">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-100 border-t-ai" />
              {t('assistant.searching')}
            </div>
          </div>
        )}
        {ask.isError && <ErrorState message={t(errorKey(ask.error))} onRetry={lastQuestion ? () => submit(lastQuestion) : undefined} />}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 mt-8 -mx-1 rounded-2xl border border-line bg-surface/95 p-4 shadow-raised backdrop-blur">
        <label htmlFor="assistant-question" className="text-sm font-semibold text-slate-900">
          {t('assistant.questionLabel')}
        </label>
        <textarea
          id="assistant-question"
          value={question}
          maxLength={MAX_CHARS}
          rows={2}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(question)
          }}
          placeholder={t('assistant.placeholder')}
          className="mt-2 w-full resize-none rounded-xl border border-line bg-canvas p-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-surface focus:ring-2 focus:ring-brand-100 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span>{t('assistant.chars', { count: question.length, max: MAX_CHARS })}</span>
            {hasPlan && (
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} />
                {t('assistant.usePlan')}
              </label>
            )}
          </div>
          <button type="submit" disabled={question.trim().length < 3 || ask.isPending} className={buttonClass('primary', 'md')}>
            <Icon name="send" className="h-4 w-4" />
            {ask.isPending ? t('assistant.thinking') : t('assistant.ask')}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{t('assistant.quotaNote')}</p>
      </form>
    </div>
  )
}
