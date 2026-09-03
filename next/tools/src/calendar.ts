/**
 * Calendar-domain tools: event queries, create/update/delete, participants,
 * and free-room lookup. The event object is also the anchor the graph's
 * five-edge event model hangs off, so these reads are what "材料就绪度" will
 * later derive from — the tools stay plain; the derivation lives in the graph.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  asNumber, asRecord, asString, clipJson, named, runValue, titled, yzjToolOutput,
  listOf,
  type YzjToolBudget,
} from './shared.ts'

/** Format an epoch-ms timestamp as `MM-DD HH:mm` in local time. */
function clockTime(ms: unknown): string {
  const value = asNumber(ms)
  if (value === undefined) return ''
  const date = new Date(value)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function eventLine(record: unknown): string {
  const event = asRecord(record)
  const title = asString(event.title)
  const id = asString(event.id)
  const start = clockTime(event.startDate)
  const end = clockTime(event.endDate)
  const person = asString(event.personName)
  const status = asNumber(event.meetingStatus)
  const parts = [title === '' ? id : title]
  if (start !== '') parts.push(`${start}${end === '' ? '' : `→${end}`}`)
  if (person !== '') parts.push(person)
  if (status !== undefined && status !== 1) parts.push(`状态 ${String(status)}`)
  if (id !== '' && id !== title) parts.push(`(${id})`)
  return parts.join(' · ')
}

function namedLine(record: unknown, nameKeys: readonly string[], idKeys: readonly string[]): string {
  const item = asRecord(record)
  const name = nameKeys.map(key => asString(item[key])).find(value => value !== '') ?? ''
  const id = idKeys.map(key => asString(item[key])).find(value => value !== '') ?? ''
  return name === '' ? id : `${name}${id === '' ? '' : ` (${id})`}`
}

/** Register the calendar-domain tools. Returns the disposer for all of them. */
export function applyCalendarTools(ctx: Context, budget: YzjToolBudget): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'yzj_calendar_event_list',
    description: 'List calendar events in a time window (pure dates or datetimes; windows over 30 days are split and deduplicated by the CLI). Returns one line per event.',
    presentCall: args => titled(`看日程 ${args.start.slice(0, 10)} 起`, 'read'),
    parameters: {
      start: { type: 'string', required: true, description: 'Start: "YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss", with timezone, or unix seconds/ms.' },
      end: { type: 'string', required: true, description: 'End (same formats).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'calendar event list',
        ['calendar', 'event', 'list', '--start', args.start, '--end', args.end], (json) => {
          const events = listOf(json)
          const lines = events.map(eventLine)
          return {
            content: lines.length === 0 ? '(no events)' : lines.join('\n'),
            data: { list: clipJson(events, { maxChars: budget.maxMetaChars }) },
          }
        })
    },
  }))

  register(defineTool({
    name: 'yzj_calendar_event_get',
    description: 'Fetch one calendar event by id.',
    presentCall: args => titled(`查看日程 ${args.id}`, 'read'),
    parameters: { id: { type: 'string', required: true, description: 'Event id.' } },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'calendar event get', ['calendar', 'event', 'get', '--id', args.id], (json) => {
        const event = asRecord(json)
        return {
          content: eventLine(event),
          data: { record: clipJson(event, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_calendar_event_create',
    description: 'Create a calendar event/meeting. organizerOpenIds is required; resolve openIds via yzj_contact_search first.',
    presentCall: args => titled(named('新建日程', args.title), 'edit'),
    parameters: {
      title: { type: 'string', required: true, description: 'Event title (max 100 chars).' },
      start: { type: 'string', required: true, description: 'Start time (see yzj_calendar_event_list formats).' },
      end: { type: 'string', required: true, description: 'End time.' },
      organizerOpenIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Organizer openIds (required).' },
      openId: { type: 'string', description: 'Operating user openId (required under app-level authorization).' },
      description: { type: 'string', description: 'Event description.' },
      roomId: { type: 'string', description: 'Meeting room id (from yzj_calendar_room_find).' },
      attendeeOpenIds: { type: 'array', items: { type: 'string' }, description: 'Attendee openIds.' },
      calendarId: { type: 'string', description: 'Calendar id; omit for the main calendar.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.organizerOpenIds.length === 0) {
        throw new Error('yzj_calendar_event_create: organizerOpenIds must not be empty')
      }
      const command = [
        'calendar', 'event', 'create',
        '--title', args.title, '--start', args.start, '--end', args.end,
      ]
      if (args.openId !== undefined) command.push('--open-id', args.openId)
      for (const id of args.organizerOpenIds) command.push('--meet-organizer-open-ids', id)
      if (args.description !== undefined) command.push('--description', args.description)
      if (args.roomId !== undefined) command.push('--room-id', args.roomId)
      for (const id of args.attendeeOpenIds ?? []) command.push('--attendee-open-ids', id)
      if (args.calendarId !== undefined) command.push('--calendar-id', args.calendarId)
      return runValue(ctx, budget, 'calendar event create', command, (json) => {
        const event = asRecord(json)
        const id = asString(event.id)
        return {
          content: `created 日程 "${args.title}"${id === '' ? '' : ` (${id})`}`,
          data: { record: clipJson(event, { maxChars: budget.maxMetaChars }), id },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_calendar_event_update',
    description: 'Update a calendar event; only the provided fields change.',
    presentCall: args => titled(args.title === undefined ? `改日程 ${args.id}` : named('日程改为', args.title), 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'Event id.' },
      openId: { type: 'string', description: 'Operating user openId (required under app-level authorization).' },
      title: { type: 'string', description: 'New title.' },
      start: { type: 'string', description: 'New start time.' },
      end: { type: 'string', description: 'New end time.' },
      description: { type: 'string', description: 'New description.' },
      roomId: { type: 'string', description: 'New room id.' },
      addAttendeeOpenIds: { type: 'array', items: { type: 'string' }, description: 'Attendees to add.' },
      removeAttendeeOpenIds: { type: 'array', items: { type: 'string' }, description: 'Attendees to remove.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['calendar', 'event', 'update', '--id', args.id]
      if (args.openId !== undefined) command.push('--open-id', args.openId)
      if (args.title !== undefined) command.push('--title', args.title)
      if (args.start !== undefined) command.push('--start', args.start)
      if (args.end !== undefined) command.push('--end', args.end)
      if (args.description !== undefined) command.push('--description', args.description)
      if (args.roomId !== undefined) command.push('--room-id', args.roomId)
      for (const id of args.addAttendeeOpenIds ?? []) command.push('--add-attendee-open-ids', id)
      for (const id of args.removeAttendeeOpenIds ?? []) command.push('--remove-attendee-open-ids', id)
      return runValue(ctx, budget, 'calendar event update', command, json => ({
        content: `updated 日程 (${args.id})`,
        data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id },
      }))
    },
  }))

  register(defineTool({
    name: 'yzj_calendar_event_delete',
    description: 'Cancel (soft, default) or hard-delete a calendar event. Requires user confirmation.',
    presentCall: args => titled(`删除日程 ${args.id}`, 'delete'),
    parameters: {
      id: { type: 'string', required: true, description: 'Event id.' },
      openId: { type: 'string', description: 'Operating user openId (required under app-level authorization).' },
      hard: { type: 'boolean', description: 'Hard-delete irreversibly; omit for soft cancellation.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      // `--yes` 的理由见 doc.ts 的 yzj_doc_delete —— 操作者已在强确认卡上签过字。
      const command = ['calendar', 'event', 'delete', '--id', args.id, '--yes']
      if (args.openId !== undefined) command.push('--open-id', args.openId)
      if (args.hard === true) command.push('--hard')
      return runValue(ctx, budget, 'calendar event delete', command, () => ({
        content: `${args.hard === true ? 'hard-deleted' : 'cancelled'} 日程 (${args.id})`,
        data: { id: args.id, hard: args.hard === true },
      }))
    },
  }))

  register(defineTool({
    name: 'yzj_calendar_event_participants',
    description: 'List the participants of a calendar event.',
    presentCall: args => titled(`看日程 ${args.id} 的参与人`, 'read'),
    parameters: { id: { type: 'string', required: true, description: 'Event id.' } },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'calendar event participants',
        ['calendar', 'event', 'participants', '--id', args.id], (json) => {
          const participants = listOf(json)
          const lines = participants.map(record => namedLine(record, ['name', 'personName'], ['openId', 'openid']))
          return {
            content: lines.length === 0 ? '(no participants)' : lines.join('\n'),
            data: { list: clipJson(participants, { maxChars: budget.maxMetaChars }) },
          }
        })
    },
  }))

  register(defineTool({
    name: 'yzj_calendar_room_find',
    description: 'Find free meeting rooms for a time slot within ONE day (start and end must share a date). Query only — booking happens via yzj_calendar_event_create with roomId.',
    presentCall: () => titled('找可用会议室', 'search'),
    parameters: {
      start: { type: 'string', required: true, description: 'Slot start (datetime).' },
      end: { type: 'string', required: true, description: 'Slot end (same day).' },
      openId: { type: 'string', description: 'Operating user openId (required under app-level authorization).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['calendar', 'room', 'find', '--start', args.start, '--end', args.end]
      if (args.openId !== undefined) command.push('--open-id', args.openId)
      return runValue(ctx, budget, 'calendar room find', command, (json) => {
        const rooms = listOf(json)
        const lines = rooms.map(record => namedLine(record, ['name', 'roomName'], ['id', 'roomId']))
        return {
          content: lines.length === 0 ? '(no free rooms)' : lines.join('\n'),
          data: { list: clipJson(rooms, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
