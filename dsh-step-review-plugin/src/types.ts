/**
 * Configuration, resolved specification, and outcome types for `dsh-step-review-plugin`.
 * @module dsh-step-review-plugin/types
 */

import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Model-visible feedback message injected when a user evaluates a completed step. */
    'step-review': { kind: 'step-review' } & ContextFormed
  }
}

/** Action taken after the user selects an evaluation option. */
export type StepReviewAction = 'continue' | 'feedback' | 'stop'

/** Policy applied when no interactive `userQuestions` answerer is connected. */
export type UnavailablePolicy = 'continue' | 'stop'

/** Policy applied when the user dismisses the evaluation card without choosing an option. */
export type DismissPolicy = 'stop' | 'continue'

/** User-configurable evaluation option in `cordis.yml`. */
export interface StepReviewOptionConfig {
  /** User-facing option label displayed in the evaluation card. */
  label: string
  /** Optional supporting description rendered under the option label. */
  description?: string
  /** Behavior triggered when the user clicks this option. */
  action: StepReviewAction
  /**
   * Model-facing feedback prompt injected when `action` is `'feedback'`.
   * Supports `{turn}` and `{step}` placeholders; defaults to `label` when omitted.
   */
  feedbackText?: string
}

/** Validated and normalized evaluation option. */
export interface ResolvedStepReviewOption {
  /** Non-empty trimmed option label. */
  readonly label: string
  /** Optional non-empty trimmed description. */
  readonly description?: string
  /** Action triggered by this option. */
  readonly action: StepReviewAction
  /** Optional non-empty trimmed feedback template. */
  readonly feedbackText?: string
}

/** Validated and defaulted specification produced by `resolveConfig`. */
export interface ResolvedStepReviewConfig {
  /** Validated non-empty question id. */
  readonly questionId: string
  /** Validated non-empty heading template. */
  readonly header: string
  /** Validated non-empty question template. */
  readonly question: string
  /** Optional validated non-empty detail template. */
  readonly detail?: string
  /** Validated non-empty feedback prefix. */
  readonly feedbackPrefix: string
  /** Resolved unavailable-answerer policy. */
  readonly onUnavailable: UnavailablePolicy
  /** Resolved dismissed-question policy. */
  readonly onDismiss: DismissPolicy
  /** Validated non-empty list of distinct evaluation options. */
  readonly options: readonly ResolvedStepReviewOption[]
}

/** Coordinates of the completed step being evaluated. */
export interface StepPosition {
  /** 1-based turn number in the session. */
  readonly turn: number
  /** 1-based step number within the turn. */
  readonly step: number
}

/** Decision produced after the user answers or dismisses the step evaluation prompt. */
export type StepReviewOutcome =
  | { readonly kind: 'continue' }
  | { readonly kind: 'feedback'; readonly message: UserMessage }
  | { readonly kind: 'stop' }
