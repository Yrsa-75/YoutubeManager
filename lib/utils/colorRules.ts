import type { Video, ColorRule } from '@/types'
import { differenceInDays, parseISO } from 'date-fns'

export function applyColorRules(video: Video, rules: ColorRule[]): string {
  const enabledRules = rules
    .filter((r: ColorRule) => r.enabled)
    .sort((a: ColorRule, b: ColorRule) => a.priority - b.priority)

  for (const rule of enabledRules) {
    if (matchesRule(video, rule)) return rule.color
  }
  return ''
}

function matchesRule(video: Video, rule: ColorRule): boolean {
  const results = rule.conditions.map((cond: any) => matchesCondition(video, cond))
  return rule.logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

function matchesCondition(video: Video, cond: any): boolean {
  let fieldValue: number | string = 0

  switch (cond.field) {
    case 'view_count': fieldValue = video.view_count; break
    case 'like_count': fieldValue = video.like_count; break
    case 'comment_count': fieldValue = video.comment_count; break
    case 'days_since_upload':
      try { fieldValue = differenceInDays(new Date(), parseISO(video.published_at)) }
      catch { fieldValue = 0 }
      break
    case 'status': fieldValue = video.status; break
    default: return false
  }

  // Support both "operator" and "op" field names
  const operator = cond.operator || cond.op
  const val = Number(cond.value)

  switch (operator) {
    case 'gt': return Number(fieldValue) > val
    case 'lt': return Number(fieldValue) < val
    case 'gte': return Number(fieldValue) >= val
    case 'lte': return Number(fieldValue) <= val
    case 'eq': return fieldValue === cond.value
    case 'days_since': return Number(fieldValue) >= val
    default: return false
  }
}
