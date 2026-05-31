import {
  type TaskHistoryEntry,
  type TaskHistoryType,
} from '@/types/tasks'
import { 
  Activity,
  CalendarDays,
  CheckCircle2,
  User, 
  Users, 
  FileEdit,
  Tag,
  Briefcase
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface TaskHistoryLogProps {
  history: TaskHistoryEntry[]
}

const HISTORY_ICONS: Record<TaskHistoryType, LucideIcon> = {
  STATUS_CHANGE: CheckCircle2,
  DEADLINE_CHANGE: CalendarDays,
  ASSIGNEE_CHANGE: User,
  OVERDUE_REASON: FileEdit,
  TEAM_CHANGE: Users,
  TAG_CHANGE: Tag,
  PROJECT_CHANGE: Briefcase,
  REVIEW_STATUS_CHANGE: Activity,
}

const HISTORY_LABELS: Record<TaskHistoryType, string> = {
  STATUS_CHANGE: 'Изменен статус',
  DEADLINE_CHANGE: 'Изменен дедлайн',
  ASSIGNEE_CHANGE: 'Изменен исполнитель',
  OVERDUE_REASON: 'Указана причина просрочки',
  TEAM_CHANGE: 'Изменен состав команды',
  TAG_CHANGE: 'Изменены теги',
  PROJECT_CHANGE: 'Изменены проекты',
  REVIEW_STATUS_CHANGE: 'Изменен статус ревью',
}

const formatDate = (dateString: string) => {
  return new Intl.DateTimeFormat('ru-RU', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  }).format(new Date(dateString))
}

const formatDateTime = (dateString: string) => {
  return new Intl.DateTimeFormat('ru-RU', { 
    day: 'numeric', 
    month: 'short', 
    hour: '2-digit', 
    minute: '2-digit' 
  }).format(new Date(dateString))
}

// Helper to format details safely
const formatDetails = (type: TaskHistoryType, details: Record<string, unknown> | null | undefined): string => {
  if (!details) return ''

  try {
    switch (type) {
      case 'STATUS_CHANGE':
        return `${details.from ?? '...'} ➔ ${details.to ?? '...'}`
      
      case 'DEADLINE_CHANGE':
        const fromDate = details.from ? formatDate(String(details.from)) : 'нет'
        const toDate = details.to ? formatDate(String(details.to)) : 'нет'
        return `${fromDate} ➔ ${toDate}`
      
      case 'ASSIGNEE_CHANGE':
        return `${details.fromName ?? 'Не назначен'} ➔ ${details.toName ?? 'Не назначен'}`

      case 'TEAM_CHANGE':
         // This might be complex json, let's simplify
         return 'Обновлен список участников'

      case 'TAG_CHANGE':
      case 'PROJECT_CHANGE':
         return 'Обновлен список'

      case 'REVIEW_STATUS_CHANGE':
         return `${details.from ?? '...'} ➔ ${details.to ?? '...'}`
      
      default:
        return JSON.stringify(details)
    }
  } catch {
    return 'Детали изменения недоступны'
  }
}

export function TaskHistoryLog({ history }: TaskHistoryLogProps) {
  if (!history || history.length === 0) {
    return <div className="text-xs text-muted-foreground italic">История изменений пуста</div>
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">История изменений</h4>
      <div className="max-h-[200px] w-full overflow-y-auto rounded-md border bg-muted/20 p-3">
        <div className="space-y-4">
          {history.map((entry) => {
            const Icon = HISTORY_ICONS[entry.type] || Activity
            return (
              <div key={entry.id} className="relative pl-4 pb-1 border-l border-border last:border-0 last:pb-0">
                <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rounded-full bg-background border border-primary" />
                
                <div className="flex flex-col gap-1 -mt-1.5">
                   <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                         <Icon className="h-3 w-3 text-muted-foreground" />
                         {HISTORY_LABELS[entry.type] || entry.type}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </span>
                   </div>
                   
                   <p className="text-[11px] text-muted-foreground">
                     <span className="text-foreground/80">{entry.actorName || 'Система'}</span>: {formatDetails(entry.type, entry.details)}
                   </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
