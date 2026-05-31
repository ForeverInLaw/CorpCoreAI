'use client'

import { useState, useRef, memo } from 'react'
import {
  IconClock,
  IconDotsVertical,
  IconPaperclip,
  IconUser,
  IconCircleCheck,
  IconAlertCircle,
  IconFileText,
  IconShield,
  IconX,
} from '@tabler/icons-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

import type {
  Task,
  TaskStatus,
  UserPayload,
  EmployeeOption,
  TaskAssignmentMember,
  Attachment,
} from '@/types/tasks'

import { TaskHistoryLog } from '@/components/TaskHistoryLog'

interface TaskCardProps {
  task: Task
  currentUser: UserPayload | null
  employees: EmployeeOption[]

  // State Props (passed from parent to maintain logic)
  isManager: boolean
  teamDraft: TaskAssignmentMember[]
  deadlineDraft: string

  // Status & Errors
  isUpdating: boolean
  updateError?: string
  teamError?: string
  uploadError?: string
  downloadingAttachmentId: string | null
  uploadingTaskId: string | null

  // Handlers
  onStatusChange: (status: TaskStatus) => void
  onDeadlineChange: (date: string) => void
  onDeadlineSave: () => void
  onAssigneeChange: (assigneeId: string) => void

  onTeamReset: () => void
  onTeamSave: () => void
  onTeamAddMember: (userId: string) => void
  onTeamRemoveMember: (userId: string) => void

  onReviewAction: (action: 'APPROVE' | 'REJECT') => void

  onFileUpload: (file: File) => void
  onFileDownload: (attachment: Attachment) => void
}

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; icon: typeof IconClock }
> = {
  IN_PROGRESS: {
    label: 'In Progress',
    color: 'bg-blue-500/10 text-blue-600 border-blue-200',
    icon: IconClock,
  },
  DONE: {
    label: 'Done',
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
    icon: IconCircleCheck,
  },
  PAUSED: {
    label: 'Paused',
    color: 'bg-amber-500/10 text-amber-600 border-amber-200',
    icon: IconAlertCircle,
  },
  OVERDUE: {
    label: 'Overdue',
    color: 'bg-red-500/10 text-red-600 border-red-200',
    icon: IconAlertCircle,
  },
  CLOSED: {
    label: 'Closed',
    color: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: IconX,
  },
}

export const TaskCard = memo(function TaskCard({
  task,
  currentUser,
  employees,
  isManager,
  teamDraft,
  deadlineDraft,
  isUpdating,
  updateError,
  teamError,
  uploadError,
  downloadingAttachmentId,
  uploadingTaskId,
  onStatusChange,
  onDeadlineChange,
  onDeadlineSave,
  onAssigneeChange,
  onTeamReset,
  onTeamSave,
  onTeamAddMember,
  onTeamRemoveMember,
  onReviewAction,
  onFileUpload,
  onFileDownload,
}: TaskCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const statusConfig = STATUS_CONFIG[task.status]
  const StatusIcon = statusConfig.icon

  const availableEmployeesForTask = employees.filter(
    (employee) => !teamDraft.some((member) => member.userId === employee.id),
  )

  const canUpload =
    currentUser?.role === 'MANAGER' ||
    task.creatorId === currentUser?.id ||
    task.assigneeId === currentUser?.id

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || Number.isNaN(bytes)) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  let reviewBadgeVariant: 'default' | 'destructive' | 'secondary' = 'secondary'
  if (task.completionReviewStatus === 'APPROVED') {
    reviewBadgeVariant = 'default'
  } else if (task.completionReviewStatus === 'REJECTED') {
    reviewBadgeVariant = 'destructive'
  }

  return (
    <Card className="group border-border/40 bg-card hover:border-border/80 relative shadow-sm transition-all hover:shadow-md">
      <CardHeader className="p-5 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Badge
                variant="outline"
                className={cn(
                  'flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium tracking-wider uppercase transition-colors',
                  statusConfig.color,
                )}
              >
                <StatusIcon className="h-3 w-3" />
                {statusConfig.label}
              </Badge>
              {task.deadline && (
                <span
                  className={cn(
                    'flex items-center gap-1 text-[11px] font-medium',
                    new Date(task.deadline) < new Date() &&
                      task.status !== 'DONE'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {new Date(task.deadline) < new Date() &&
                    task.status !== 'DONE' && (
                      <IconAlertCircle className="h-3 w-3" />
                    )}
                  {new Intl.DateTimeFormat('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                  }).format(new Date(task.deadline))}
                </span>
              )}
            </div>
            <h3 className="text-foreground text-lg leading-snug font-semibold tracking-tight">
              {task.title}
            </h3>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground -mr-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Действия"
              >
                <IconDotsVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Действия</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? 'Свернуть' : 'Подробнее'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onStatusChange('CLOSED')}
              >
                Закрыть задачу
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-5 pt-2">
        {task.overdueReason && (
          <div className="bg-destructive/10 text-destructive border-destructive/20 rounded-md border p-2.5 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <IconAlertCircle className="h-3.5 w-3.5" />
              Причина просрочки
            </div>
            <p className="leading-relaxed opacity-90">{task.overdueReason}</p>
          </div>
        )}

        <p
          className={cn(
            'text-muted-foreground text-sm leading-relaxed',
            !isExpanded && 'line-clamp-3',
          )}
        >
          {task.description}
        </p>

        {/* Compact Tags View */}
        {!isExpanded && task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {task.tags.map((tag) => (
              <span
                key={tag.id}
                className="text-muted-foreground bg-secondary/50 rounded-full px-2 py-0.5 text-[10px] font-medium"
              >
                #{tag.label}
              </span>
            ))}
          </div>
        )}

        {isExpanded && (
          <div className="animate-in fade-in slide-in-from-top-2 space-y-6 duration-200">
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="bg-secondary/10 rounded-lg border p-3">
                <h4 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                  Подзадачи
                </h4>
                <ul className="space-y-1.5">
                  {task.subtasks.map((sub) => (
                    <li key={sub} className="flex items-start gap-2 text-sm">
                      <div className="bg-primary/40 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                      <span className="leading-relaxed">{sub}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Separator />

            {/* Assignments */}
            <div className="grid gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Команда
                  </Label>
                  {isManager && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={onTeamReset}
                        disabled={isUpdating}
                        aria-label="Сбросить команду"
                      >
                        <IconX className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={onTeamSave}
                        disabled={isUpdating}
                        aria-label="Сохранить команду"
                      >
                        <IconCircleCheck className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="bg-secondary/20 space-y-2 rounded-lg p-3">
                  {teamDraft.length === 0 ? (
                    <span className="text-muted-foreground text-sm italic">
                      Нет участников
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {teamDraft.map((member) => (
                        <Badge
                          key={member.userId}
                          variant={member.isLead ? 'default' : 'secondary'}
                          className="hover:bg-primary/20 flex items-center gap-1 py-1 pr-2 pl-1"
                        >
                          {member.isLead && <IconShield className="h-3 w-3" />}
                          <span className="text-xs">{member.name}</span>
                          {isManager && (
                            <IconX
                              className="ml-1 h-3 w-3 cursor-pointer opacity-50 hover:opacity-100"
                              onClick={() => onTeamRemoveMember(member.userId)}
                            />
                          )}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {isManager && (
                    <div className="pt-2">
                      <Select onValueChange={onTeamAddMember}>
                        <SelectTrigger className="bg-background h-8 text-xs">
                          <SelectValue placeholder="Добавить..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableEmployeesForTask.map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {teamError && (
                    <p className="text-destructive text-xs">{teamError}</p>
                  )}
                </div>
              </div>

              {/* Details & Meta */}
              <div className="space-y-3">
                <Label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Детали
                </Label>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Статус</span>
                    <Select
                      value={task.status}
                      onValueChange={(v) => onStatusChange(v as TaskStatus)}
                      disabled={isUpdating}
                    >
                      <SelectTrigger className="col-span-2 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_CONFIG).map(([key, conf]) => (
                          <SelectItem key={key} value={key}>
                            {conf.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Срок</span>
                    <div className="col-span-2 flex gap-1">
                      <Input
                        type="date"
                        className="h-8 text-xs"
                        value={deadlineDraft ?? ''}
                        onChange={(e) => onDeadlineChange(e.target.value)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={onDeadlineSave}
                        aria-label="Сохранить срок"
                      >
                        <IconCircleCheck className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {isManager && (
                    <div className="grid grid-cols-3 items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Исполн.</span>
                      <Select
                        value={task.assigneeId ?? ''}
                        onValueChange={onAssigneeChange}
                        disabled={isUpdating}
                      >
                        <SelectTrigger className="col-span-2 h-8">
                          <SelectValue placeholder="Не назначен" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">
                            Не назначен
                          </SelectItem>
                          {employees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Review Section */}
            {task.completionReviewStatus && (
              <div className="bg-muted/30 rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Ревью выполнения</span>
                  <Badge variant={reviewBadgeVariant}>
                    {task.completionReviewStatus}
                  </Badge>
                </div>
                {task.completionReviewStatus === 'PENDING' && isManager && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      onClick={() => onReviewAction('APPROVE')}
                      disabled={isUpdating}
                    >
                      Подтвердить
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 flex-1 text-xs"
                      onClick={() => onReviewAction('REJECT')}
                      disabled={isUpdating}
                    >
                      Отклонить
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Attachments */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Вложения
                </Label>
                {canUpload && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingTaskId === task.id}
                  >
                    {uploadingTaskId === task.id ? 'Загрузка...' : '+ Добавить'}
                  </Button>
                )}
                <input
                  type="file"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(e) =>
                    e.target.files?.[0] && onFileUpload(e.target.files[0])
                  }
                />
              </div>

              {task.attachments && task.attachments.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {task.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="bg-background hover:bg-accent/50 flex items-center justify-between rounded-md border p-2 text-sm transition-colors"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                          <IconFileText className="text-primary h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-medium">
                            {att.fileName || 'Файл'}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {formatFileSize(att.sizeBytes)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onFileDownload(att)}
                        disabled={downloadingAttachmentId === att.id}
                        aria-label={`Скачать ${att.fileName || 'файл'}`}
                      >
                        <IconPaperclip className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">Нет вложений</p>
              )}
              {uploadError && (
                <p className="text-destructive text-xs">{uploadError}</p>
              )}
            </div>

            <Separator />

            <TaskHistoryLog history={task.history || []} />

            {updateError && (
              <div className="bg-destructive/10 text-destructive rounded-md p-2 text-xs">
                {updateError}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Footer Summary (Always Visible) */}
      {!isExpanded && (
        <CardFooter className="bg-muted/10 border-border/40 text-muted-foreground flex items-center justify-between border-t px-5 py-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <IconUser className="h-3.5 w-3.5" />
              <span>{task.assigneeName || 'Не назначен'}</span>
            </div>
            {task.attachments && task.attachments.length > 0 && (
              <div className="flex items-center gap-1.5">
                <IconPaperclip className="h-3.5 w-3.5" />
                <span>{task.attachments.length}</span>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="hover:text-primary h-auto p-0 text-xs hover:bg-transparent"
            onClick={() => setIsExpanded(true)}
          >
            Подробнее
          </Button>
        </CardFooter>
      )}
    </Card>
  )
})
