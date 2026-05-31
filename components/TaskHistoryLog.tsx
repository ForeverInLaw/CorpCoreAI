import { type TaskHistoryEntry, type TaskHistoryType } from '@/types/tasks'
import {
  IconActivity,
  IconCalendar,
  IconCircleCheck,
  IconUser,
  IconUsers,
  IconPencil,
  IconTag,
  IconBriefcase,
} from '@tabler/icons-react'

interface TaskHistoryLogProps {
  history: TaskHistoryEntry[]
}

const HISTORY_ICONS: Record<TaskHistoryType, typeof IconActivity> = {
  STATUS_CHANGE: IconCircleCheck,
  DEADLINE_CHANGE: IconCalendar,
  ASSIGNEE_CHANGE: IconUser,
  OVERDUE_REASON: IconPencil,
  TEAM_CHANGE: IconUsers,
  TAG_CHANGE: IconTag,
  PROJECT_CHANGE: IconBriefcase,
  REVIEW_STATUS_CHANGE: IconActivity,
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

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDate = (dateString: string) =>
  dateFormatter.format(new Date(dateString))

const formatDateTime = (dateString: string) =>
  dateTimeFormatter.format(new Date(dateString))

// Helper to format details safely
const safeStringify = (value: unknown): string => {
  if (value == null) return '...'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const formatDetails = (
  type: TaskHistoryType,
  details: Record<string, unknown> | null | undefined,
): string => {
  if (!details) return ''

  try {
    switch (type) {
      case 'STATUS_CHANGE':
        return `${safeStringify(details.from)} ➔ ${safeStringify(details.to)}`

      case 'DEADLINE_CHANGE': {
        const fromDate = details.from ? formatDate(safeStringify(details.from)) : 'нет'
        const toDate = details.to ? formatDate(safeStringify(details.to)) : 'нет'
        return `${fromDate} ➔ ${toDate}`
      }

      case 'ASSIGNEE_CHANGE':
        return `${safeStringify(details.fromName ?? 'Не назначен')} ➔ ${safeStringify(details.toName ?? 'Не назначен')}`

      case 'TEAM_CHANGE':
        return 'Обновлен список участников'

      case 'TAG_CHANGE':
      case 'PROJECT_CHANGE':
        return 'Обновлен список'

      case 'REVIEW_STATUS_CHANGE':
        return `${safeStringify(details.from)} ➔ ${safeStringify(details.to)}`

      default:
        return JSON.stringify(details)
    }
  } catch {
    return 'Детали изменения недоступны'
  }
}

export function TaskHistoryLog({ history }: Readonly<TaskHistoryLogProps>) {
  if (!history || history.length === 0) {
    return (
      <div className="text-muted-foreground text-xs italic">
        История изменений пуста
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        История изменений
      </h4>
      <div className="bg-muted/20 max-h-[200px] w-full overflow-y-auto rounded-md border p-3">
        <div className="space-y-4">
          {history.map((entry) => {
            const Icon = HISTORY_ICONS[entry.type] || IconActivity
            return (
              <div
                key={entry.id}
                className="border-border relative border-l pb-1 pl-4 last:border-0 last:pb-0"
              >
                <div className="bg-background border-primary absolute top-0 -left-[5px] h-2.5 w-2.5 rounded-full border" />

                <div className="-mt-1.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                      <Icon className="text-muted-foreground h-3 w-3" />
                      {HISTORY_LABELS[entry.type] || entry.type}
                    </span>
                    <span className="text-muted-foreground text-[10px] whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>

                  <p className="text-muted-foreground text-[11px]">
                    <span className="text-foreground/80">
                      {entry.actorName || 'Система'}
                    </span>
                    : {formatDetails(entry.type, entry.details)}
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
