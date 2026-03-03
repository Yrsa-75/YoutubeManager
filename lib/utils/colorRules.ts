import type { Video, ColorRule } from '@/types'
import { differenceInDays, parseISO } from 'date-fns'

export function applyColorRules(video: Video, rules: ColorRule[]): string {
  const enabledRules = rules
    .filter(r => r.enabled)
    .sort((a, b) => a.priority - b.priority)

  for (const rule of enabledRules) {
    if (matchesRule(video, rule)) return rule.color
  }
  return ''
}

function matchesRule(video: Video, rule: ColorRule): boolean {
  const results = rule.conditions.map(cond => matchesCondition(video, cond))
  return rule.logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

function matchesCondition(video: Video, cond: ColorCondition): boolean {
  let fieldValue: any

  switch (cond.field) {
    case 'view_count': fieldValue = video.view_count; break
    case 'like_count': fieldValue = video.like_count; break
    case 'comment_count': fieldValue = video.comment_count; break
    case 'days_since_upload':
      fieldValue = differenceInDays(new Date(), parseISO(video.published_at))
      break
    case 'status': fieldValue = video.status; break
    default: return false
  }

  const val = Number(cond.value)
  switch (cond.operator) {
    case 'gt': return fieldValue > val
    case 'lt': return fieldValue < val
    case 'gte': return fieldValue >= val
    case 'lte': return fieldValue <= val
    case 'eq': return fieldValue === cond.value
    case 'days_since': return fieldValue >= val
    default: return false
  }
}
