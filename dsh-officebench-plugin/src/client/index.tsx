/**
 * Browser client entry (`exports["./client"]`) for `dsh-officebench-plugin`.
 *
 * Registers:
 * - Left-sidebar navigation item + Main Panel (`OfficeBench workbench`)
 * - Right-sidebar per-session Inspector tab (`officebench`)
 * - Session-header quick pill (`conversation.session.header.utilities`)
 * - Keyed custom `tool.call.toolview` rows for all 24 OfficeBench tools
 *
 * All runtime imports stay strictly within DSH's `PLATFORM_MODULES` baseline so
 * zero extra `dsh.client.external` entries are needed.
 *
 * @module dsh-officebench-plugin/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReactElement } from 'react'
import { OfficeBenchIcon } from './icons.tsx'
import { InspectorTab, InspectorTabTitle, type InspectorInjected } from './InspectorTab.tsx'
import { en, zh, type OfficeBenchLocaleKey } from './locales.ts'
import { OfficeBenchToolRow } from './OfficeBenchToolRow.tsx'
import { createOfficeBenchClient } from './rpc.ts'
import { SessionHeaderAction, type SessionHeaderInjected } from './SessionHeaderAction.tsx'
import { WorkbenchPage, type WorkbenchInjected } from './WorkbenchPage.tsx'
import type { OfficeBenchRunRecord } from '../types.ts'

const NS = 'officebench'
const PANEL_ID = 'officebench' as MainPanelId
const TAB_KIND = 'officebench'
const TAB_ID = 'dsh-officebench-plugin/inspector'
const PRESET_ID = 'officebench'

const OFFICEBENCH_WIRE_TOOLS = [
  'officebench_list_files',
  'officebench_read_text',
  'excel_read_file',
  'excel_create_new_file',
  'excel_set_cell',
  'excel_delete_cell',
  'excel_convert_to_pdf',
  'word_create_new_file',
  'word_read_file',
  'word_write_to_file',
  'word_convert_to_pdf',
  'pdf_read_file',
  'pdf_convert_to_word',
  'pdf_convert_to_image',
  'image_convert_to_pdf',
  'ocr_recognize_file',
  'email_list_emails',
  'email_read_email',
  'email_send_email',
  'calendar_list_events',
  'calendar_create_event',
  'calendar_delete_event',
  'shell_command',
  'finish_task',
] as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    officebench: OfficeBenchLocaleKey
  }
}

/** Required browser services provided by `dsh-web-app`. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'layout',
  'sessions',
  'workspaces',
  'uiWorkspace',
  'sidebarRight',
  'sidebarRightTabs',
]

function SidebarEntryIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactElement {
  return <OfficeBenchIcon size={size} />
}

function GuideEntryIcon(): ReactElement {
  return <OfficeBenchIcon size={20} />
}

/**
 * Mount the OfficeBench browser UI plugin into the DSH Web client tree.
 *
 * @param ctx - Client root Cordis context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const client = createOfficeBenchClient(connection)
  const evalRevision = createSnapshotStore<number>(0)
  const bumpEvalRevision = (): void => {
    evalRevision.set(evalRevision.getSnapshot() + 1)
  }

  ctx.effect(() => ctx.locale.register(NS, {
    zh,
    en,
    ja: en,
    es: en,
    fr: en,
    de: en,
    ru: en,
    pt: en,
  }), 'dsh-officebench-plugin: locales')

  const t = ctx.locale.bind(NS)

  const openWorkbench = (): void => {
    ctx.layout.selectPanel(PANEL_ID)
  }

  const openInspector = (): void => {
    try {
      ctx.sidebarRight.openTab(TAB_KIND)
    } catch (_error: unknown) {
      // No active session currently mounted on screen.
    }
  }

  const launchTask = async (taskKey: string, mode: 'run' | 'draft'): Promise<void> => {
    const created = await client.call('runs/create', { taskKey })
    const workspace = await ctx.workspaces.create({ path: created.run.testbedDir })
    try {
      await ctx.workspaces.rename(workspace.workspaceId, `OB ${created.run.taskKey}`)
    } catch (_error: unknown) {
      // Renaming workspace is purely cosmetic; continue launching even if unsupported.
    }

    if (mode === 'draft') {
      ctx.uiWorkspace.startSession(workspace.workspaceId, {
        agentPreset: PRESET_ID,
        prompt: created.suggestedPrompt,
        whenDraftExists: 'replace',
      })
      setTimeout(() => { openInspector() }, 150)
      return
    }

    const sessionId = await ctx.sessions.create({
      workspaceId: workspace.workspaceId,
      agentPreset: PRESET_ID,
    })
    await client.call('runs/bind-session', { runId: created.run.runId, sessionId })
    bumpEvalRevision()
    ctx.uiWorkspace.openSession(sessionId)

    const binding = ctx.sessions.binding(sessionId)
    if (binding !== undefined) {
      void binding.session.rename(`OfficeBench ${created.run.taskKey}`).catch(() => {})
      const sendResult = await binding.session.prompt(
        [{ type: 'text', text: created.suggestedPrompt }],
        'queue',
      )
      if (!sendResult.ok) {
        throw new Error(sendResult.error.message)
      }
    }
    setTimeout(() => { openInspector() }, 150)
  }

  const openRunSession = (run: OfficeBenchRunRecord): void => {
    if (run.sessionId === undefined) return
    ctx.uiWorkspace.openSession(run.sessionId as SessionId)
    setTimeout(() => { openInspector() }, 150)
  }

  const tabDefinition: SidebarRightTabDefinition = {
    id: TAB_ID,
    kind: TAB_KIND,
    priority: 'extension',
    title: () => t('inspector.tabTitle'),
    guide: [{
      id: 'officebench-inspector',
      order: 60,
      title: () => t('inspector.guideTitle'),
      description: () => t('inspector.guideDesc'),
      icon: GuideEntryIcon,
    }],
  }
  ctx.effect(() => ctx.sidebarRightTabs.register(tabDefinition), 'dsh-officebench-plugin: inspector tab type')

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): WorkbenchInjected => ({
      client,
      launchTask,
      openRunSession,
    }),
  }, WorkbenchPage)), 'dsh-officebench-plugin: workbench main panel')

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 25,
    locale: NS,
    label: () => t('panel.label'),
  }, SidebarEntryIcon)), 'dsh-officebench-plugin: sidebar nav item')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: (): InspectorInjected => ({
      client,
      openWorkbench,
      notifyEvaluation: () => { bumpEvalRevision() },
    }),
  }, InspectorTab)), 'dsh-officebench-plugin: inspector body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TAB_ID,
    locale: NS,
  }, InspectorTabTitle)), 'dsh-officebench-plugin: inspector title')

  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'officebench-inspector',
    order: -6,
    locale: NS,
    inject: (): SessionHeaderInjected => ({
      client,
      openInspector,
      hooks: { evalRevision },
    }),
  }, SessionHeaderAction)), 'dsh-officebench-plugin: session header action')

  ctx.effect(() => ctx.slots.inject('tool.call.toolview', function* () {
    for (const toolName of OFFICEBENCH_WIRE_TOOLS) {
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key: toolName,
        locale: NS,
      }, OfficeBenchToolRow)
    }
  }), 'dsh-officebench-plugin: tool rows')
}
