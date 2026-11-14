import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ErrorState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import { useLocalized } from '../../lib/useLocalized'
import type { ApiErrorDetail, AssistantAnswer } from '../../types/api'
import { planRequestOf, readSavedPlan } from '../planner/usePlannerState'
import { useServices } from '../services/api'
import { AnswerCard } from './AnswerCard'
import { useAskAssistant } from './api'

const MAX_CHARS = 1000
const EXAMPLES = ['example1', 'example2', 'example3', 'example4', 'example5'] as const
const PLAN_EXAMPLES = ['planQ1', 'planQ2'] as const

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
              // The same request the planner page sends, so both explain the same plan.
              workflow: planRequestOf(saved),
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
  const ask_ = (text: string) => {
    setQuestion(text)
    submit(text)
  }

  const composer = (
    <form
      onSubmit={onSubmit}
      className={`rounded-[1.75rem] bg-card p-3 ring-2 ring-ink/85 transition focus-within:shadow-lift focus-within:ring-ink ${empty ? 'shadow-lift' : 'shadow-soft'}`}
    >
      <label htmlFor="assistant-question" className="sr-only">
        {t('assistant.questionLabel')}
      </label>
      <textarea
        id="assistant-question"
        value={question}
        maxLength={MAX_CHARS}
        rows={empty ? 3 : 2}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(question)
        }}
        placeholder={t('assistant.placeholder')}
        className="w-full resize-none bg-transparent px-3 pt-2 text-base text-ink placeholder:text-faint focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-2 text-xs text-muted">
          <span className="tabular-nums">{t('assistant.chars', { count: question.length, max: MAX_CHARS })}</span>
          {hasPlan && (
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-ink">
              <input type="checkbox" className="h-4 w-4" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} />
              {t('assistant.usePlan')}
            </label>
          )}
        </div>
        <button type="submit" disabled={question.trim().length < 3 || ask.isPending} className={buttonClass('primary', 'md')}>
          <Icon name="send" className="h-4 w-4" />
          {ask.isPending ? t('assistant.thinking') : t('assistant.ask')}
        </button>
      </div>
    </form>
  )

  if (empty) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="animate-rise text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-zest-400 shadow-lift">
            <Icon name="spark" className="h-7 w-7" />
          </span>
          <p className="mt-6 text-xs font-bold tracking-[0.18em] text-jade-700 uppercase">{t('assistant.eyebrow')}</p>
          <h1 className="mt-3 font-display text-4xl leading-tight font-semibold tracking-tight text-ink sm:text-5xl">{t('assistant.welcomeTitle')}</h1>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted">{t('assistant.intro')}</p>
        </div>

        <div className="mt-10 animate-rise" style={{ animationDelay: '0.08s' }}>
          {composer}
          <p className="mt-3 text-center text-[11px] text-faint">{t('assistant.quotaNote')}</p>
        </div>

        {hasPlan && (
          <section className="mt-10 animate-rise" style={{ animationDelay: '0.14s' }}>
            <p className="flex items-center gap-2 text-xs font-bold tracking-[0.16em] text-ink uppercase">
              <span className="h-2 w-2 animate-beacon rounded-full bg-zest-400" aria-hidden />
              {t('assistant.aboutYourPlan')}
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {PLAN_EXAMPLES.map((k) => (
                <li key={k}>
                  <SuggestionButton disabled={ask.isPending} accent onClick={() => ask_(t(`assistant.${k}`))}>
                    {t(`assistant.${k}`)}
                  </SuggestionButton>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 animate-rise" style={{ animationDelay: '0.2s' }}>
          <p className="text-xs font-bold tracking-[0.16em] text-muted uppercase">{t('assistant.tryAsking')}</p>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {EXAMPLES.map((k) => (
              <li key={k}>
                <SuggestionButton disabled={ask.isPending} onClick={() => ask_(t(`assistant.${k}`))}>
                  {t(`assistant.${k}`)}
                </SuggestionButton>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-answers" className="mt-12 animate-rise" style={{ animationDelay: '0.26s' }}>
          <h2 id="how-answers" className="text-xs font-bold tracking-[0.16em] text-muted uppercase">
            {t('assistant.howAnswers')}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            <li className="rounded-2xl border border-rule bg-card p-4">
              <span className="rounded-md bg-ink px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper">S1</span>
              <p className="mt-3 text-sm leading-relaxed text-ink/80">{t('assistant.legendExcerpt')}</p>
            </li>
            <li className="rounded-2xl bg-jade-50 p-4 ring-1 ring-jade-100">
              <span className="rounded-md bg-jade-600 px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper">K1</span>
              <p className="mt-3 text-sm leading-relaxed text-jade-800">{t('assistant.legendFact')}</p>
            </li>
            <li className="rounded-2xl bg-lilac-50 p-4 ring-1 ring-lilac-100">
              <span className="text-xs font-bold text-lilac-700">✦ AI</span>
              <p className="mt-3 text-sm leading-relaxed text-lilac-700">{t('assistant.legendAi')}</p>
            </li>
          </ul>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-14rem)] max-w-3xl flex-col">
      <header className="flex items-center gap-3 border-b border-rule pb-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-zest-400">
          <Icon name="spark" className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{t('assistant.title')}</h1>
          <p className="text-xs text-muted">{t('assistant.conversationHint')}</p>
        </div>
      </header>

      <div className="flex-1 space-y-10 py-8" aria-live="polite">
        {history.map((ex) => (
          <div key={ex.id} className="space-y-5">
            <UserBubble text={ex.question} />
            <AssistantTurn>
              <AnswerCard answer={ex.answer} prefix={`a${ex.id}`} serviceName={serviceName} />
            </AssistantTurn>
          </div>
        ))}

        {ask.isPending && (
          <div className="space-y-5">
            <UserBubble text={lastQuestion} />
            <AssistantTurn>
              <div role="status" className="rounded-[1.5rem] rounded-tl-md bg-card p-5 ring-1 ring-rule sm:p-6">
                <p className="flex items-center gap-3 text-sm font-semibold text-ink">
                  <span className="flex gap-1" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1.5 w-1.5 animate-dots rounded-full bg-lilac-500" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                  {t('assistant.searching')}
                </p>
                <div className="mt-5 space-y-2.5" aria-hidden>
                  {['w-11/12', 'w-full', 'w-3/4'].map((w) => (
                    <span key={w} className={`block h-3 animate-pulse rounded-full bg-paper-deep ${w}`} />
                  ))}
                </div>
              </div>
            </AssistantTurn>
          </div>
        )}
        {ask.isError && (
          <AssistantTurn>
            <ErrorState message={t(errorKey(ask.error))} onRetry={lastQuestion ? () => submit(lastQuestion) : undefined} />
          </AssistantTurn>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-paper via-paper to-paper/0 pt-6 pb-4">
        {composer}
        <p className="mt-2 text-center text-[11px] text-faint">{t('assistant.quotaNote')}</p>
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-[1.5rem] rounded-br-md bg-ink px-5 py-3 text-[15px] leading-relaxed text-paper sm:max-w-[75%]">{text}</p>
    </div>
  )
}

function AssistantTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lilac-50 text-lilac-700 ring-1 ring-lilac-100 sm:flex" aria-hidden>
        <Icon name="spark" className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function SuggestionButton({ children, onClick, disabled, accent = false }: { children: ReactNode; onClick: () => void; disabled: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group flex h-full w-full items-center gap-3 text-left text-sm transition ${
        accent ? 'rounded-2xl bg-zest-100 px-4 py-3.5 font-semibold text-ink ring-1 ring-zest-300 hover:bg-zest-200' : 'px-1 py-3.5 text-ink/85 hover:text-ink'
      }`}
    >
      <Icon name={accent ? 'plan' : 'chat'} className={`h-4 w-4 shrink-0 ${accent ? 'text-ink' : 'text-jade-600'}`} />
      <span className="flex-1">{children}</span>
      <Icon name="arrow" className="h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
    </button>
  )
}
