'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

type TaskStatus = 'IN_PROGRESS' | 'DONE' | 'PAUSED' | 'OVERDUE' | 'CLOSED'

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

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TaskStatus>('IN_PROGRESS')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [currentUser, setCurrentUser] = useState<UserPayload | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
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
        setDeadlineDrafts((prev) => {
          const next = { ...prev }
          data.tasks.forEach((task) => {
            next[task.id] = task.deadline ? task.deadline.slice(0, 10) : ''
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
    return tasks.filter((task) => {
      const matchStatus = task.status === activeTab
      const matchAssignee = selectedAssignee === 'all' || task.assigneeId === selectedAssignee
      return matchStatus && matchAssignee
    })
  }, [tasks, activeTab, selectedAssignee])

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

  const handleTaskUpdate = async (taskId: string, payload: { status?: TaskStatus; deadline?: string | null; assigneeId?: string | null }) => {
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
              filteredTasks.map(task => (
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
                            <Badge variant="destructive" className="text-xs">Просрочено</Badge>
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
                                {attachment.mimeType ?? 'Неизвестный тип'} · {formatFileSize(attachment.sizeBytes)} ·
                                {' '}
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
                          disabled={updatingTasks[task.id]}
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
                            disabled={updatingTasks[task.id]}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={updatingTasks[task.id]}
                            onClick={() => handleDeadlineSave(task.id)}
                          >
                            Сохранить дедлайн
                          </Button>
                          {isManager && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-destructive"
                              disabled={updatingTasks[task.id]}
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
                            disabled={updatingTasks[task.id]}
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
                              ref={(ref) => { fileInputRefs.current[task.id] = ref }}
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
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
