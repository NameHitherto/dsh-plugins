/**
 * Minimal stroke SVG icons sized to match DSH sidebar and panel chrome.
 *
 * @module dsh-officebench-plugin/client/icons
 */

import type { ReactElement } from 'react'

export interface IconProps {
  readonly size?: number
  readonly className?: string
}

/** Briefcase / office benchmark icon used in the left sidebar and right-sidebar tab chip. */
export function OfficeBenchIcon({ size = 16, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2.5" y="5.5" width="15" height="11" rx="2.2" />
      <path d="M7 5.5V4.2A1.7 1.7 0 0 1 8.7 2.5h2.6A1.7 1.7 0 0 1 13 4.2v1.3" />
      <path d="M2.5 10h15" />
      <path d="M8.5 10v1.8h3V10" />
    </svg>
  )
}

/** Checkmark circle icon for passed evaluation rules. */
export function CheckCircleIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.4 8.2 7.2 10l3.5-3.8" />
    </svg>
  )
}

/** Cross circle icon for failed evaluation rules. */
export function CrossCircleIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.8 5.8 10.2 10.2M10.2 5.8 5.8 10.2" />
    </svg>
  )
}

/** Play triangle icon for launch actions. */
export function PlayIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.2 3.1a.6.6 0 0 1 .9-.52l7.6 4.9a.6.6 0 0 1 0 1.04l-7.6 4.9a.6.6 0 0 1-.9-.52V3.1Z" />
    </svg>
  )
}

/** Refresh circular arrow icon. */
export function RefreshIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.35-3.6" />
      <path d="M13.5 2.75v2.75h-2.75" />
    </svg>
  )
}
