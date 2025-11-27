'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

type TaskStatus = 'IN_PROGRESS' | 'DONE' | 'PAUSED' | 'OVERDUE' | 'CLOSED'

type TaskCompletionReviewStatus = 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED'

type TaskHistoryType =
  | 'STATUS_CHANGE'
  | 'DEADLINE_CHANGE'
  | 'ASSIGNEE_CHANGE'
  | 'OVERDUE_REASON'
  | 'TEAM_CHANGE'
  | 'TAG_CHANGE'
  | 'PROJECT_CHANGE'
  | 'REVIEW_STATUS_CHANGE'

interface TagOption {
  id: number
  label: string
  color: string | null
}

interface ProjectOption {
  id: number
  name: string
  color: string | null
}

interface TaskAssignmentMember {
  userId: string
  name: string
  isLead: boolean
}

interface TaskHistoryEntry {
  id: string
  type: TaskHistoryType
  details?: Record<string, unknown> | null
  createdAt: string
  actorId: string | null
  actorName: string | null
}

interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  deadline: string | null
  subtasks: string[] | null
  createdAt: string
  assigneeId?: string | null
  assigneeName?: string | null
  creatorId: string
  creatorName?: string | null
  overdueReason?: string | null
  attachments?: Attachment[]
  history?: TaskHistoryEntry[]
  assignments?: TaskAssignmentMember[]
  tags?: TagOption[]
  projects?: ProjectOption[]
  completionReviewStatus?: TaskCompletionReviewStatus | null
  completionRequestedAt?: string | null
  completionReviewedAt?: string | null
  completionReviewedById?: string | null
  completionReviewedByName?: string | null
}

interface UserPayload {
  id: string
  role: 'EMPLOYEE' | 'MANAGER'
  name?: string | null
}

interface EmployeeOption {
  id: string
  name: string
}

interface Attachment {
  id: string
  url: string
  type: string
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  createdAt: string
}

interface TasksResponse {
  tasks: Task[]
  user: UserPayload
  employees: EmployeeOption[]
  availableTags?: TagOption[]
  availableProjects?: ProjectOption[]
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  IN_PROGRESS: 'В работе',
  DONE: 'Готово',
  PAUSED: 'На паузе',
  OVERDUE: 'Просрочено',
  CLOSED: 'Закрыто',
}

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value: value as TaskStatus,
  label,
}))

const REVIEW_STATUS_LABELS: Record<TaskCompletionReviewStatus, string> = {
  NOT_REQUESTED: 'Не запрошено',
  PENDING: 'На проверке',
  APPROVED: 'Подтверждено',
  REJECTED: 'Отклонено',
}

const REVIEW_STATUS_BADGE_VARIANT: Record<TaskCompletionReviewStatus, ComponentProps<typeof Badge>['variant']> = {
  NOT_REQUESTED: 'outline',
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TaskStatus>('IN_PROGRESS')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [currentUser, setCurrentUser] = useState<UserPayload | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [availableTags, setAvailableTags] = useState<TagOption[]>([])
  const [availableProjects, setAvailableProjects] = useState<ProjectOption[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState<string>('all')
  const [accessDenied, setAccessDenied] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null)
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null)
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({})
  const [deadlineDrafts, setDeadlineDrafts] = useState<Record<string, string>>({})
  const [updatingTasks, setUpdatingTasks] = useState<Record<string, boolean>>({})
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({})
  const [teamDrafts, setTeamDrafts] = useState<Record<string, TaskAssignmentMember[]>>({})
  const [teamAddSelections, setTeamAddSelections] = useState<Record<string, Record<string, boolean>>>({})
  const [teamErrors, setTeamErrors] = useState<Record<string, string>>({})
  const [tagDrafts, setTagDrafts] = useState<Record<string, number[]>>({})
  const [tagErrors, setTagErrors] = useState<Record<string, string>>({})
  const [projectDrafts, setProjectDrafts] = useState<Record<string, number[]>>({})
  const [projectErrors, setProjectErrors] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyOverdueReasons, setOnlyOverdueReasons] = useState(false)
  const telegramInitDataRef = useRef<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    // Strict production check: Must be inside Telegram WebApp
    if (globalThis.window !== undefined && (globalThis.window as any).Telegram?.WebApp) {
      const tg = (globalThis.window as any).Telegram.WebApp
      tg.ready()

      const initData = tg.initData
      if (initData) {
        setIsAuthorized(true)
        fetchTasks(initData)
      } else {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [])

  const fetchTasks = async (initData: string) => {
    setFetchError(null)
    telegramInitDataRef.current = initData
    try {
      const res = await fetch(`/api/tasks`, {
        headers: {
          'Authorization': initData
        }
      })
      if (res.status === 403) {
        setAccessDenied(true)
        setTasks([])
        setCurrentUser(null)
        setEmployees([])
      } else if (res.ok) {
        setAccessDenied(false)
        const data: TasksResponse = await res.json()
        setTasks(data.tasks)
        setCurrentUser(data.user)
        setEmployees(data.employees ?? [])
        setAvailableTags(data.availableTags ?? [])
        setAvailableProjects(data.availableProjects ?? [])
        setDeadlineDrafts((prev) => {
          const next = { ...prev }
          data.tasks.forEach((task) => {
            next[task.id] = task.deadline ? task.deadline.slice(0, 10) : ''
          })
          return next
        })
        setTeamDrafts(() => {
          const next: Record<string, TaskAssignmentMember[]> = {}
          data.tasks.forEach((task) => {
            next[task.id] = (task.assignments ?? []).map((member) => ({ ...member }))
          })
          return next
        })
        setTagDrafts(() => {
          const next: Record<string, number[]> = {}
          data.tasks.forEach((task) => {
            next[task.id] = (task.tags ?? []).map((tag) => tag.id)
          })
          return next
        })
        setProjectDrafts(() => {
          const next: Record<string, number[]> = {}
          data.tasks.forEach((task) => {
            next[task.id] = (task.projects ?? []).map((project) => project.id)
          })
          return next
        })
      } else {
        setFetchError('Failed to fetch tasks')
      }
    } catch (error) {
      console.error(error)
      setFetchError('Failed to fetch tasks')
    } finally {
      setLoading(false)
    }
  }

  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchStatus = task.status === activeTab
      const matchAssignee = selectedAssignee === 'all' || task.assigneeId === selectedAssignee
      const matchSearch = normalizedQuery
        ? [task.title, task.description, task.overdueReason]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(normalizedQuery)) ||
          (task.history ?? []).some((entry) => {
            const details = entry.details as Record<string, unknown> | undefined
            const reason = typeof details?.reason === 'string' ? details.reason : ''
            return reason.toLowerCase().includes(normalizedQuery)
          })
        : true
      const hasOverdueReasonHistory = (task.history ?? []).some((entry) => entry.type === 'OVERDUE_REASON')
      const matchOverdueReasonFilter = onlyOverdueReasons ? hasOverdueReasonHistory : true
      return matchStatus && matchAssignee && matchSearch && matchOverdueReasonFilter
    })
  }, [tasks, activeTab, selectedAssignee, searchQuery, onlyOverdueReasons])

  const isManager = currentUser?.role === 'MANAGER'

  const canUploadToTask = (task: Task) => {
    if (!currentUser) return false
    if (currentUser.role === 'MANAGER') return true
    if (task.creatorId === currentUser.id) return true
    if (task.assigneeId && task.assigneeId === currentUser.id) return true
    return false
  }

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || Number.isNaN(bytes)) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatDateUtc = (iso?: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'UTC' })
  }

  type TaskUpdatePayload = {
    status?: TaskStatus
    deadline?: string | null
    assigneeId?: string | null
    assignments?: { userId: string; isLead?: boolean }[]
    tagIds?: number[]
    projectIds?: number[]
    reviewAction?: 'APPROVE' | 'REJECT'
  }

  const handleTaskUpdate = async (taskId: string, payload: TaskUpdatePayload) => {
    if (!telegramInitDataRef.current) return
    setUpdatingTasks((prev) => ({ ...prev, [taskId]: true }))
    setUpdateErrors((prev) => ({ ...prev, [taskId]: '' }))

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          Authorization: telegramInitDataRef.current,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to update task')
      }

      if (telegramInitDataRef.current) {
        await fetchTasks(telegramInitDataRef.current)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update task'
      setUpdateErrors((prev) => ({ ...prev, [taskId]: message }))
    } finally {
      setUpdatingTasks((prev) => ({ ...prev, [taskId]: false }))
    }
  }

  const handleStatusChange = async (taskId: string, nextStatus: TaskStatus) => {
    await handleTaskUpdate(taskId, { status: nextStatus })
  }

  const handleDeadlineInput = (taskId: string, value: string) => {
    setDeadlineDrafts((prev) => ({ ...prev, [taskId]: value }))
  }

  const handleDeadlineSave = async (taskId: string) => {
    const raw = (deadlineDrafts[taskId] ?? '').trim()
    if (!raw) {
      await handleTaskUpdate(taskId, { deadline: null })
      return
    }

    const isoDate = `${raw}T00:00:00.000Z`
    await handleTaskUpdate(taskId, { deadline: isoDate })
  }

  const handleAssigneeChange = async (taskId: string, assigneeId: string) => {
    await handleTaskUpdate(taskId, { assigneeId: assigneeId || null })
  }

  const handleDeadlineClear = async (taskId: string) => {
    setDeadlineDrafts((prev) => ({ ...prev, [taskId]: '' }))
    await handleTaskUpdate(taskId, { deadline: null })
  }

  const normalizeTeamLead = (members: TaskAssignmentMember[]) => {
    if (members.length === 0) {
      return members
    }
    if (members.some((member) => member.isLead)) {
      return members
    }
    const [first, ...rest] = members
    return [{ ...first, isLead: true }, ...rest]
  }

  const clearFieldError = (
    taskId: string,
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) => {
    setter((prev) => {
      if (!prev[taskId]) return prev
      const { [taskId]: _removed, ...rest } = prev
      return rest
    })
  }

  const haveSameNumberSet = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false
    const setA = new Set(a)
    return b.every((value) => setA.has(value))
  }

  const updateTeamDraft = (taskId: string, updater: (current: TaskAssignmentMember[]) => TaskAssignmentMember[]) => {
    setTeamDrafts((prev) => ({
      ...prev,
      [taskId]: updater(prev[taskId] ?? []),
    }))
  }

  const handleTeamAddMember = (taskId: string, userId: string) => {
    if (!userId) return
    const employee = employees.find((entry) => entry.id === userId)
    if (!employee) return
    updateTeamDraft(taskId, (current) => {
      if (current.some((member) => member.userId === userId)) {
        return current
      }
      const isFirstMember = current.length === 0
      return [
        ...current,
        {
          userId,
          name: employee.name,
          isLead: isFirstMember,
        },
      ]
    })
    clearFieldError(taskId, setTeamErrors)
  }

  const handleTeamSelectionChange = (taskId: string, userId: string, checked: boolean) => {
    setTeamAddSelections((prev) => {
      const current = prev[taskId] ?? {}
      return {
        ...prev,
        [taskId]: {
          ...current,
          [userId]: checked,
        },
      }
    })
  }

  const handleTeamSetLead = (taskId: string, userId: string) => {
    updateTeamDraft(taskId, (current) =>
      current.map((member) => ({
        ...member,
        isLead: member.userId === userId,
      }))
    )
    clearFieldError(taskId, setTeamErrors)
  }

  const handleTeamRemoveMember = (taskId: string, userId: string) => {
    updateTeamDraft(taskId, (current) => current.filter((member) => member.userId !== userId))
    clearFieldError(taskId, setTeamErrors)
  }

  const handleTeamReset = (task: Task) => {
    setTeamDrafts((prev) => ({
      ...prev,
      [task.id]: (task.assignments ?? []).map((member) => ({ ...member })),
    }))
    clearFieldError(task.id, setTeamErrors)
  }

  const handleTeamSave = async (taskId: string) => {
    const draft = normalizeTeamLead(teamDrafts[taskId] ?? [])
    if (draft.length === 0) {
      setTeamErrors((prev) => ({ ...prev, [taskId]: 'Назначьте хотя бы одного участника.' }))
      return
    }

    if (!draft.some((member) => member.isLead)) {
      setTeamErrors((prev) => ({ ...prev, [taskId]: 'Необходимо выбрать лидера команды.' }))
      return
    }

    clearFieldError(taskId, setTeamErrors)
    setTeamDrafts((prev) => ({ ...prev, [taskId]: draft }))

    await handleTaskUpdate(taskId, {
      assignments: draft.map((member) => ({
        userId: member.userId,
        isLead: member.isLead,
      })),
    })
  }

    const toggleEntityDraft = (
    taskId: string,
    entityId: number,
    setter: Dispatch<SetStateAction<Record<string, number[]>>>
  ) => {
    setter((prev) => {
      const current = prev[taskId] ?? []
      const exists = current.includes(entityId)
      const next = exists ? current.filter((id) => id !== entityId) : [...current, entityId]
      return { ...prev, [taskId]: next }
    })
  }

  const handleTagToggle = (taskId: string, tagId: number) => {
    toggleEntityDraft(taskId, tagId, setTagDrafts)
    clearFieldError(taskId, setTagErrors)
  }
  const handleProjectToggle = (taskId: string, projectId: number) => {
    toggleEntityDraft(taskId, projectId, setProjectDrafts)
    clearFieldError(taskId, setProjectErrors)
  }

  const handleTagReset = (task: Task) => {
    setTagDrafts((prev) => ({
      ...prev,
      [task.id]: (task.tags ?? []).map((tag) => tag.id),
    }))
    clearFieldError(task.id, setTagErrors)
  }

  const handleProjectReset = (task: Task) => {
    setProjectDrafts((prev) => ({
      ...prev,
      [task.id]: (task.projects ?? []).map((project) => project.id),
    }))
    clearFieldError(task.id, setProjectErrors)
  }

  const handleTagSave = async (taskId: string) => {
    const draft = tagDrafts[taskId] ?? []
    if (draft.length === 0) {
      setTagErrors((prev) => ({ ...prev, [taskId]: 'Выберите хотя бы один тег.' }))
      return
    }

    const original = (tasks.find((task) => task.id === taskId)?.tags ?? []).map((tag) => tag.id)
    if (haveSameNumberSet(draft, original)) {
      setTagErrors((prev) => ({ ...prev, [taskId]: 'Изменений не обнаружено.' }))
      return
    }

    clearFieldError(taskId, setTagErrors)
    await handleTaskUpdate(taskId, { tagIds: draft })
  }

  const handleProjectSave = async (taskId: string) => {
    const draft = projectDrafts[taskId] ?? []
    if (draft.length === 0) {
      setProjectErrors((prev) => ({ ...prev, [taskId]: 'Выберите хотя бы один проект.' }))
      return
    }

    const original = (tasks.find((task) => task.id === taskId)?.projects ?? []).map((project) => project.id)
    if (haveSameNumberSet(draft, original)) {
      setProjectErrors((prev) => ({ ...prev, [taskId]: 'Изменений не обнаружено.' }))
      return
    }

    clearFieldError(taskId, setProjectErrors)
    await handleTaskUpdate(taskId, { projectIds: draft })
  }

  const handleReviewAction = async (taskId: string, action: 'APPROVE' | 'REJECT') => {
    await handleTaskUpdate(taskId, { reviewAction: action })
  }

  const handleFileUpload = async (taskId: string, file: File) => {
    if (!telegramInitDataRef.current) return
    setUploadingTaskId(taskId)
    setUploadErrors((prev) => ({ ...prev, [taskId]: '' }))

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        headers: {
          Authorization: telegramInitDataRef.current,
        },
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Upload failed')
      }

      if (telegramInitDataRef.current) {
        await fetchTasks(telegramInitDataRef.current)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload file'
      setUploadErrors((prev) => ({ ...prev, [taskId]: message }))
    } finally {
      setUploadingTaskId(null)
    }
  }

  const handleFileChange = async (taskId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await handleFileUpload(taskId, file)
    event.target.value = ''
  }

  const requestDownloadUrl = async (attachmentId: string) => {
    if (!telegramInitDataRef.current) {
      throw new Error('Authorization missing')
    }

    const response = await fetch(`/api/attachments/${attachmentId}/token`, {
      method: 'POST',
      headers: {
        Authorization: telegramInitDataRef.current,
      },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Failed to generate download link')
    }

    const data: { url?: string; token: string; expiresAt: string } = await response.json()
    return data.url ?? `/api/attachments/download/${data.token}`
  }

  const handleAttachmentDownload = async (attachment: Attachment) => {
    try {
      setDownloadingAttachmentId(attachment.id)
      setDownloadErrors((prev) => ({ ...prev, [attachment.id]: '' }))
      const downloadUrl = await requestDownloadUrl(attachment.id)
      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to prepare download'
      setDownloadErrors((prev) => ({ ...prev, [attachment.id]: message }))
    } finally {
      setDownloadingAttachmentId(null)
    }
  }

  const renderHistoryEntry = (entry: TaskHistoryEntry) => {
    const details = (entry.details ?? {}) as Record<string, unknown>
    switch (entry.type) {
      case 'STATUS_CHANGE':
        return `Статус: ${String(details.from ?? '—')} → ${String(details.to ?? '—')}`
      case 'DEADLINE_CHANGE':
        return `Дедлайн: ${details.from ? new Date(details.from as string).toLocaleDateString() : '—'} → ${details.to ? new Date(details.to as string).toLocaleDateString() : '—'}`
      case 'ASSIGNEE_CHANGE':
        return `Исполнитель: ${(details.fromName as string) ?? '—'} → ${(details.toName as string) ?? '—'}`
      case 'OVERDUE_REASON':
        return `Причина просрочки: ${(details.reason as string) ?? '—'}`
      default:
        return 'Обновление задачи'
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Загрузка...</div>
  }

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Доступ запрещен</CardTitle>
            <CardDescription>
              Пожалуйста, откройте это приложение из Telegram.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (accessDenied) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Доступ ограничен</CardTitle>
            <CardDescription>
              Ваш аккаунт Telegram не добавлен в белый список для этого рабочего пространства.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Что-то пошло не так</CardTitle>
            <CardDescription>{fetchError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => fetchTasks((globalThis.window as any).Telegram.WebApp.initData)}>
              Повторить
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 max-w-3xl space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Менеджер задач</h1>
          {currentUser && (
            <Badge variant="outline">{isManager ? 'Менеджер' : 'Сотрудник'}</Badge>
          )}
        </div>
        {currentUser?.name && (
          <p className="text-muted-foreground text-sm">Вы вошли как {currentUser.name}</p>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          onClick={() => fetchTasks((globalThis.window as any).Telegram.WebApp.initData)}
          disabled={loading}
          className="self-start"
        >
          Обновить
        </Button>

        {isManager && (
          <label className="flex flex-col gap-2 w-full sm:w-64 text-sm">
            <span className="text-muted-foreground">Фильтр по исполнителю</span>
            <select
              className="border rounded-md px-3 py-2 bg-background"
              value={selectedAssignee}
              onChange={(event) => setSelectedAssignee(event.target.value)}
            >
              <option value="all">Все сотрудники</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-2 text-sm w-full">
          <span className="text-muted-foreground">Поиск по задачам и причинам просрочек</span>
          <input
            type="text"
            className="border rounded-md px-3 py-2 bg-background"
            placeholder="Введите текст..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        {isManager && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={onlyOverdueReasons}
              onChange={(event) => setOnlyOverdueReasons(event.target.checked)}
            />
            <span>Только задачи с объяснённой просрочкой</span>
          </label>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TaskStatus)}>
        <TabsList className="flex flex-wrap w-full">
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="flex-1 min-w-[120px]">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {Object.keys(STATUS_LABELS).map((status) => (
          <TabsContent key={status} value={status} className="mt-4 space-y-4">
            {filteredTasks.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Задачи не найдены.</p>
            ) : (
              filteredTasks.map((task) => {
                const teamDraft = teamDrafts[task.id] ?? (task.assignments ?? [])
                const tagDraft = tagDrafts[task.id] ?? (task.tags ?? []).map((tag) => tag.id)
                const projectDraft = projectDrafts[task.id] ?? (task.projects ?? []).map((project) => project.id)
                const availableEmployeesForTask = employees.filter(
                  (employee) => !teamDraft.some((member) => member.userId === employee.id)
                )
                const teamSelectionMap = teamAddSelections[task.id] ?? {}
                const teamSelection = Object.entries(teamSelectionMap)
                  .filter(([, selected]) => selected)
                  .map(([userId]) => userId)
                const isReviewPending = task.status === 'DONE' && task.completionReviewStatus === 'PENDING'
                const isUpdating = Boolean(updatingTasks[task.id])
                const hasLead = teamDraft.some((member) => member.isLead)

                return (
                  <Card key={task.id}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-lg">{task.title}</CardTitle>
                        <Badge variant={task.status === 'DONE' ? 'default' : 'secondary'}>
                          {STATUS_LABELS[task.status]}
                        </Badge>
                      </div>
                      <CardDescription className="flex flex-col gap-1">
                        <span>Создана: {new Date(task.createdAt).toLocaleDateString()}</span>
                        {task.deadline && (
                          <span className="flex items-center gap-2">
                            Дедлайн: {formatDateUtc(task.deadline)}
                            {new Date(task.deadline) < new Date() && task.status !== 'DONE' && (
                              <Badge variant="destructive" className="text-xs">
                                Просрочено
                              </Badge>
                            )}
                          </span>
                        )}
                        {task.overdueReason && (
                          <span className="text-sm text-destructive/80 mt-1">
                            Причина просрочки: {task.overdueReason}
                          </span>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-wrap mb-4">{task.description}</p>
                      <div className="text-sm text-muted-foreground space-y-1 mb-4">
                        <p>Создатель: {task.creatorName ?? 'Неизвестно'}</p>
                        <p>Исполнитель: {task.assigneeName ?? 'Не назначен'}</p>
                      </div>

                      <div className="space-y-6 mb-6">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">Команда</label>
                            {isManager && (
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTeamReset(task)}
                                  disabled={isUpdating}
                                >
                                  Сбросить
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleTeamSave(task.id)}
                                  disabled={isUpdating}
                                >
                                  Сохранить состав
                                </Button>
                              </div>
                            )}
                          </div>
                          {teamDraft.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Команда не назначена.</p>
                          ) : (
                            <ul className="space-y-2">
                              {teamDraft.map((member) => (
                                <li key={`${task.id}-${member.userId}`} className="flex flex-wrap items-center gap-2 text-sm">
                                  <Badge variant={member.isLead ? 'default' : 'outline'}>{member.name}</Badge>
                                  {member.isLead && <span className="text-xs text-muted-foreground">Лидер</span>}
                                  {isManager && (
                                    <div className="flex gap-2">
                                      {!member.isLead && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => handleTeamSetLead(task.id, member.userId)}
                                          disabled={isUpdating}
                                        >
                                          Сделать лидером
                                        </Button>
                                      )}
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive"
                                        onClick={() => handleTeamRemoveMember(task.id, member.userId)}
                                        disabled={isUpdating}
                                      >
                                        Удалить
                                      </Button>
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {teamDraft.length > 0 && !hasLead && (
                            <p className="text-xs text-destructive">Выберите лидера команды.</p>
                          )}
                          {teamErrors[task.id] && (
                            <p className="text-xs text-destructive">{teamErrors[task.id]}</p>
                          )}
                          {isManager && (
                            <div className="flex flex-col gap-2">
                              {availableEmployeesForTask.length === 0 ? (
                                <p className="text-xs text-muted-foreground">Нет свободных сотрудников.</p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {availableEmployeesForTask.map((employee) => (
                                    <label
                                      key={employee.id}
                                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        className="accent-primary"
                                        checked={Boolean(teamSelectionMap[employee.id])}
                                        onChange={(event) =>
                                          handleTeamSelectionChange(task.id, employee.id, event.target.checked)
                                        }
                                        disabled={isUpdating}
                                      />
                                      <span>{employee.name}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                disabled={teamSelection.length === 0 || isUpdating}
                                onClick={() => {
                                  const selection = teamSelection
                                  if (selection.length === 0) return
                                  selection.forEach((userId) => handleTeamAddMember(task.id, userId))
                                  setTeamAddSelections((prev) => {
                                    const { [task.id]: _removed, ...rest } = prev
                                    return rest
                                  })
                                }}
                              >
                                Добавить в команду
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">Теги</label>
                            {isManager && availableTags.length > 0 && (
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTagReset(task)}
                                  disabled={isUpdating}
                                >
                                  Сбросить
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTagSave(task.id)}
                                  disabled={isUpdating}
                                >
                                  Сохранить теги
                                </Button>
                              </div>
                            )}
                          </div>
                          {isManager ? (
                            availableTags.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Теги ещё не настроены.</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {availableTags.map((tag) => {
                                  const isSelected = tagDraft.includes(tag.id)
                                  return (
                                    <label
                                      key={tag.id}
                                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                                        isSelected ? 'bg-primary/10 border-primary' : 'bg-background'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="accent-primary"
                                        checked={isSelected}
                                        onChange={() => handleTagToggle(task.id, tag.id)}
                                        disabled={isUpdating}
                                      />
                                      <span>#{tag.label}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            )
                          ) : task.tags && task.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {task.tags.map((tag) => (
                                <Badge key={tag.id} variant="outline">
                                  #{tag.label}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">Нет тегов.</p>
                          )}
                          {tagErrors[task.id] && (
                            <p className="text-xs text-destructive">{tagErrors[task.id]}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">Проекты</label>
                            {isManager && availableProjects.length > 0 && (
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleProjectReset(task)}
                                  disabled={isUpdating}
                                >
                                  Сбросить
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleProjectSave(task.id)}
                                  disabled={isUpdating}
                                >
                                  Сохранить проекты
                                </Button>
                              </div>
                            )}
                          </div>
                          {isManager ? (
                            availableProjects.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Проекты ещё не созданы.</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {availableProjects.map((project) => {
                                  const isSelected = projectDraft.includes(project.id)
                                  return (
                                    <label
                                      key={project.id}
                                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                                        isSelected ? 'bg-primary/10 border-primary' : 'bg-background'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="accent-primary"
                                        checked={isSelected}
                                        onChange={() => handleProjectToggle(task.id, project.id)}
                                        disabled={isUpdating}
                                      />
                                      <span>{project.name}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            )
                          ) : task.projects && task.projects.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {task.projects.map((project) => (
                                <Badge key={project.id} variant="outline">
                                  {project.name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">Нет проектов.</p>
                          )}
                          {projectErrors[task.id] && (
                            <p className="text-xs text-destructive">{projectErrors[task.id]}</p>
                          )}
                        </div>

                        {task.completionReviewStatus && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <label className="text-sm font-medium">Ревью выполнения</label>
                                <Badge variant={REVIEW_STATUS_BADGE_VARIANT[task.completionReviewStatus]}>
                                  {REVIEW_STATUS_LABELS[task.completionReviewStatus]}
                                </Badge>
                              </div>
                              {isReviewPending && isManager && (
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="default"
                                    disabled={isUpdating}
                                    onClick={() => handleReviewAction(task.id, 'APPROVE')}
                                  >
                                    Подтвердить
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={isUpdating}
                                    onClick={() => handleReviewAction(task.id, 'REJECT')}
                                  >
                                    Вернуть
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground flex flex-col sm:flex-row sm:gap-4">
                              {task.completionRequestedAt && (
                                <span>Запрошено: {new Date(task.completionRequestedAt).toLocaleString()}</span>
                              )}
                              {task.completionReviewedAt && (
                                <span>
                                  Проверено: {new Date(task.completionReviewedAt).toLocaleString()}
                                  {task.completionReviewedByName && ` · ${task.completionReviewedByName}`}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {task.attachments && task.attachments.length > 0 && (
                        <div className="mb-4 text-sm">
                          <p className="font-semibold mb-2">Вложения:</p>
                          <ul className="space-y-2">
                            {task.attachments.map((attachment) => (
                              <li key={attachment.id} className="flex flex-col">
                                <button
                                  type="button"
                                  className="text-left text-primary hover:underline"
                                  onClick={() => handleAttachmentDownload(attachment)}
                                  disabled={downloadingAttachmentId === attachment.id}
                                >
                                  {downloadingAttachmentId === attachment.id
                                    ? 'Подготовка ссылки...'
                                    : attachment.fileName ?? attachment.type}
                                </button>
                                <span className="text-xs text-muted-foreground">
                                  {attachment.mimeType ?? 'Неизвестный тип'} · {formatFileSize(attachment.sizeBytes)} ·{' '}
                                  {new Date(attachment.createdAt).toLocaleString()}
                                </span>
                                {downloadErrors[attachment.id] && (
                                  <span className="text-xs text-destructive">{downloadErrors[attachment.id]}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium" htmlFor={`status-${task.id}`}>
                            Статус
                          </label>
                          <select
                            id={`status-${task.id}`}
                            className="border rounded-md px-3 py-2 bg-background"
                            value={task.status}
                            onChange={(event) => handleStatusChange(task.id, event.target.value as TaskStatus)}
                            disabled={isUpdating}
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium" htmlFor={`deadline-${task.id}`}>
                            Дедлайн
                          </label>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                            <input
                              type="date"
                              id={`deadline-${task.id}`}
                              className="border rounded-md px-3 py-2 bg-background"
                              value={deadlineDrafts[task.id] ?? (task.deadline ? task.deadline.slice(0, 10) : '')}
                              onChange={(event) => handleDeadlineInput(task.id, event.target.value)}
                              disabled={isUpdating}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              disabled={isUpdating}
                              onClick={() => handleDeadlineSave(task.id)}
                            >
                              Сохранить дедлайн
                            </Button>
                            {isManager && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-destructive"
                                disabled={isUpdating}
                                onClick={() => handleDeadlineClear(task.id)}
                              >
                                Удалить дедлайн
                              </Button>
                            )}
                          </div>

                          {task.status === 'OVERDUE' && (
                            <p className="text-xs text-muted-foreground">
                              Задача просрочена — установите новый дедлайн или обновите статус.
                            </p>
                          )}
                        </div>

                        {isManager && (
                          <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium" htmlFor={`assignee-${task.id}`}>
                              Исполнитель
                            </label>
                            <select
                              id={`assignee-${task.id}`}
                              className="border rounded-md px-3 py-2 bg-background"
                              value={task.assigneeId ?? ''}
                              onChange={(event) => handleAssigneeChange(task.id, event.target.value)}
                              disabled={isUpdating}
                            >
                              <option value="">Не назначен</option>
                              {employees.map((employee) => (
                                <option key={employee.id} value={employee.id}>
                                  {employee.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {canUploadToTask(task) && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="secondary"
                                type="button"
                                onClick={() => fileInputRefs.current[task.id]?.click()}
                                disabled={uploadingTaskId === task.id}
                              >
                                {uploadingTaskId === task.id ? 'Загрузка...' : 'Прикрепить файл'}
                              </Button>
                              <input
                                type="file"
                                ref={(ref) => {
                                  fileInputRefs.current[task.id] = ref
                                }}
                                className="hidden"
                                onChange={(event) => handleFileChange(task.id, event)}
                              />
                            </div>
                            {uploadErrors[task.id] && (
                              <p className="text-sm text-destructive">{uploadErrors[task.id]}</p>
                            )}
                          </div>
                        )}

                        {updateErrors[task.id] && (
                          <p className="text-sm text-destructive">{updateErrors[task.id]}</p>
                        )}
                      </div>

                      {task.history && task.history.length > 0 && (
                        <div className="mt-4 text-sm">
                          <p className="font-semibold mb-2">История изменений</p>
                          <ul className="space-y-2 max-h-60 overflow-y-auto pr-1">
                            {task.history.map((entry) => (
                              <li key={entry.id} className="rounded-md border p-2">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                                  <span>{entry.actorName ?? (entry.actorId ? `ID ${entry.actorId}` : '—')}</span>
                                </div>
                                <p className="text-sm mt-1">{renderHistoryEntry(entry)}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {task.subtasks && Array.isArray(task.subtasks) && task.subtasks.length > 0 && (
                        <div className="bg-muted p-3 rounded-md text-sm">
                          <p className="font-semibold mb-2">Подзадачи:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {task.subtasks.map((sub: string, index: number) => (
                              <li key={`${task.id}-${index}-${sub}`}>{sub}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
