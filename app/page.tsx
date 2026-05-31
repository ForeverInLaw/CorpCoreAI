'use client'

import { useEffect, useMemo, useRef, useCallback } from 'react'
import {
  IconSearch,
  IconRefresh,
  IconBriefcase,
  IconLogout,
  IconUser as UserIcon,
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TaskCard } from '@/components/TaskCard'

import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useFiltersStore } from '@/stores/filters'
import { useUiStore } from '@/stores/ui'

import type { TaskStatus, Attachment, TasksResponse } from '@/types/tasks'

export default function Home() {
  const {
    isAuthorized,
    currentUser,
    accessDenied,
    setAuthorized,
    setCurrentUser,
    setAccessDenied,
  } = useAuthStore()
  const {
    tasks,
    loading,
    loadingMore,
    nextCursor,
    employees,
    setTasks,
    appendTasks,
    setLoading,
    setLoadingMore,
    setNextCursor,
    setEmployees,
  } = useTasksStore()
  const {
    activeTab,
    selectedAssignee,
    searchQuery,
    setActiveTab,
    setSelectedAssignee,
    setSearchQuery,
  } = useFiltersStore()
  const ui = useUiStore()

  const telegramInitDataRef = useRef<string | null>(null)

  const fetchTasks = useCallback(
    async (initData: string, cursor?: string) => {
      if (cursor) setLoadingMore(true)
      else setLoading(true)
      telegramInitDataRef.current = initData
      try {
        const url = cursor ? `/api/tasks?cursor=${cursor}` : '/api/tasks'
        const res = await fetch(url, {
          headers: { Authorization: initData },
        })
        if (res.status === 403) {
          setAccessDenied(true)
          setTasks([])
          setCurrentUser(null)
          setEmployees([])
        } else if (res.ok) {
          setAccessDenied(false)
          const data: TasksResponse = await res.json()

          if (cursor) {
            appendTasks(data.tasks)
          } else {
            setTasks(data.tasks)
            setCurrentUser(data.user)
            setEmployees(data.employees ?? [])
          }
          setNextCursor(data.nextCursor)

          initDrafts(data.tasks)
        }
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [
      setTasks,
      appendTasks,
      setLoading,
      setLoadingMore,
      setNextCursor,
      setCurrentUser,
      setEmployees,
      setAccessDenied,
    ],
  )

  useEffect(() => {
    if (
      globalThis.window !== undefined &&
      (globalThis.window as { Telegram?: { WebApp?: unknown } }).Telegram
        ?.WebApp
    ) {
      const tg = (
        globalThis.window as unknown as {
          Telegram: {
            WebApp: { ready: () => void; expand: () => void; initData: string }
          }
        }
      ).Telegram.WebApp
      tg.ready()
      tg.expand()

      const initData = tg.initData
      if (initData) {
        setAuthorized(true)
        fetchTasks(initData)
      } else {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [fetchTasks, setAuthorized, setLoading])

  type TaskUpdatePayload = {
    status?: TaskStatus
    deadline?: string | null
    assigneeId?: string | null
    assignments?: { userId: string; isLead?: boolean }[]
    tagIds?: number[]
    projectIds?: number[]
    reviewAction?: 'APPROVE' | 'REJECT'
  }

  const handleTaskUpdate = useCallback(
    async (taskId: string, payload: TaskUpdatePayload) => {
      if (!telegramInitDataRef.current) return
      ui.setUpdating(taskId, true)
      ui.setUpdateError(taskId, '')

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
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to update task')
        }

        await fetchTasks(telegramInitDataRef.current)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update task'
        ui.setUpdateError(taskId, message)
      } finally {
        ui.setUpdating(taskId, false)
      }
    },
    [fetchTasks, ui],
  )

  const handleFileUpload = useCallback(
    async (taskId: string, file: File) => {
      if (!telegramInitDataRef.current) return
      ui.setUploadingTaskId(taskId)
      ui.setUploadError(taskId, '')

      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch(`/api/tasks/${taskId}/attachments`, {
          method: 'POST',
          headers: { Authorization: telegramInitDataRef.current },
          body: formData,
        })

        if (!response.ok) throw new Error('Upload failed')
        await fetchTasks(telegramInitDataRef.current)
      } catch {
        ui.setUploadError(taskId, 'Ошибка загрузки')
      } finally {
        ui.setUploadingTaskId(null)
      }
    },
    [fetchTasks, ui],
  )

  const requestDownloadUrl = useCallback(async (attachmentId: string) => {
    if (!telegramInitDataRef.current) throw new Error('Auth missing')
    const response = await fetch(`/api/attachments/${attachmentId}/token`, {
      method: 'POST',
      headers: { Authorization: telegramInitDataRef.current },
    })
    if (!response.ok) throw new Error('Failed to link')
    const data = await response.json()
    return data.url ?? `/api/attachments/download/${data.token}`
  }, [])

  const handleFileDownload = useCallback(
    async (attachment: Attachment) => {
      try {
        ui.setDownloadingAttachmentId(attachment.id)
        const url = await requestDownloadUrl(attachment.id)
        window.open(url, '_blank')
      } catch {
        // noop — download error state removed (dead state)
      } finally {
        ui.setDownloadingAttachmentId(null)
      }
    },
    [requestDownloadUrl, ui],
  )

  const handleTeamAddMember = useCallback(
    (taskId: string, userId: string) => {
      const emp = employees.find((e) => e.id === userId)
      if (!emp) return
      ui.updateTeamDraft(taskId, (curr) =>
        curr.some((m) => m.userId === userId)
          ? curr
          : [...curr, { userId, name: emp.name, isLead: curr.length === 0 }],
      )
    },
    [employees, ui],
  )

  const handleTeamSave = useCallback(
    async (taskId: string) => {
      const draft = useUiStore.getState().teamDrafts[taskId] ?? []
      if (draft.length === 0)
        return ui.setTeamError(taskId, 'Нужен хотя бы 1 участник')
      if (!draft.some((m) => m.isLead))
        return ui.setTeamError(taskId, 'Выберите лидера')
      await handleTaskUpdate(taskId, {
        assignments: draft.map((m) => ({ userId: m.userId, isLead: m.isLead })),
      })
    },
    [handleTaskUpdate, ui],
  )

  const handleTeamRemoveMember = useCallback(
    (taskId: string, uid: string) =>
      ui.updateTeamDraft(taskId, (curr) =>
        curr.filter((m) => m.userId !== uid),
      ),
    [ui],
  )

  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchStatus = task.status === activeTab
      const matchAssignee =
        selectedAssignee === 'all' || task.assigneeId === selectedAssignee
      const matchSearch = normalizedQuery
        ? [task.title, task.description].some((f) =>
            f?.toLowerCase().includes(normalizedQuery),
          )
        : true
      return matchStatus && matchAssignee && matchSearch
    })
  }, [tasks, activeTab, selectedAssignee, searchQuery])

  const tabCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      IN_PROGRESS: 0,
      DONE: 0,
      PAUSED: 0,
      OVERDUE: 0,
      CLOSED: 0,
    }
    for (const task of tasks) counts[task.status]++
    return counts
  }, [tasks])

  const isManager = currentUser?.role === 'MANAGER'

  if (loading)
    return (
      <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-muted-foreground animate-pulse text-sm">
          Загрузка задач...
        </p>
      </div>
    )

  if (!isAuthorized || accessDenied)
    return (
      <div className="bg-background flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm space-y-4 text-center">
          <div className="bg-destructive/10 text-destructive mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <IconLogout className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold">Доступ ограничен</h2>
          <p className="text-muted-foreground text-sm">
            {accessDenied
              ? 'Ваш аккаунт не имеет прав доступа.'
              : 'Пожалуйста, откройте приложение через Telegram.'}
          </p>
        </div>
      </div>
    )

  const tabs: { id: TaskStatus; label: string }[] = [
    { id: 'IN_PROGRESS', label: 'В работе' },
    { id: 'DONE', label: 'Готово' },
    { id: 'PAUSED', label: 'На паузе' },
    { id: 'OVERDUE', label: 'Просрочено' },
    { id: 'CLOSED', label: 'Архив' },
  ]

  return (
    <div className="bg-background text-foreground min-h-screen pb-20 font-sans">
      {/* Header */}
      <header className="border-border/40 bg-background/80 supports-backdrop-filter:bg-background/60 sticky top-0 z-40 w-full border-b backdrop-blur-xl">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold tracking-tighter">
              C
            </div>
            <span className="hidden font-semibold tracking-tight sm:inline-block">
              CorpCoreAI
            </span>
          </div>

          <div className="flex items-center gap-3">
            {currentUser && (
              <div className="bg-secondary/50 border-border/50 flex items-center gap-2 rounded-full border py-1 pr-1.5 pl-3">
                <div className="flex flex-col items-end leading-none">
                  <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                    {isManager ? 'Менеджер' : 'Сотрудник'}
                  </span>
                  <span className="max-w-20 truncate text-xs font-semibold">
                    {currentUser.name?.split(' ')[0]}
                  </span>
                </div>
                <div className="bg-background flex h-7 w-7 items-center justify-center rounded-full shadow-sm">
                  <UserIcon className="text-primary h-4 w-4" />
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fetchTasks(telegramInitDataRef.current!)}
              aria-label="Обновить"
            >
              <IconRefresh className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl space-y-8 px-4 py-6">
        {/* Hero / Greeting */}
        <div className="animate-in fade-in slide-in-from-bottom-4 space-y-1 duration-500">
          <h1 className="text-foreground text-3xl font-light tracking-tight">
            Добрый день,{' '}
            <span className="font-semibold">
              {currentUser?.name?.split(' ')[0]}
            </span>
            {'.'}
          </h1>
          <p className="text-muted-foreground">
            У вас{' '}
            <span className="text-foreground font-medium">
              {tabCounts.IN_PROGRESS}
            </span>{' '}
            активных задач сегодня.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-background/95 border-border/40 sticky top-14 z-30 -mx-4 flex flex-col gap-4 border-b px-4 py-4 backdrop-blur lg:static lg:flex-row lg:items-center lg:justify-between lg:border-0 lg:bg-transparent lg:p-0">
          {/* Tabs: Wrap on all screens */}
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Статус задач"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`tabpanel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all duration-200 sm:px-4 sm:py-2 sm:text-sm ${
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground border-primary shadow-md'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/30 hover:bg-secondary/50'
                } `}
              >
                {tab.label}
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${activeTab === tab.id ? 'bg-primary-foreground/20' : 'bg-secondary'}`}
                >
                  {tabCounts[tab.id]}
                </span>
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex w-full gap-2 lg:w-auto">
            <div className="relative flex-1 lg:w-64">
              <IconSearch className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
              <Input
                placeholder="Поиск..."
                className="bg-secondary/30 focus:bg-background border-transparent pl-9 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {isManager && (
              <Select
                value={selectedAssignee}
                onValueChange={setSelectedAssignee}
              >
                <SelectTrigger className="w-10 justify-center px-0 sm:w-[180px] sm:justify-between sm:px-3">
                  <div className="hidden truncate sm:block">
                    <SelectValue placeholder="Все" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сотрудники</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Task Grid */}
        <div
          id={`tabpanel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {filteredTasks.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center space-y-4 py-12 text-center opacity-50">
              <IconBriefcase className="h-12 w-12" strokeWidth={1} />
              <p>Задач не найдено</p>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                currentUser={currentUser}
                employees={employees}
                isManager={isManager}
                teamDraft={ui.teamDrafts[task.id] ?? []}
                deadlineDraft={ui.deadlineDrafts[task.id] ?? ''}
                isUpdating={!!ui.updatingTasks[task.id]}
                updateError={ui.updateErrors[task.id]}
                teamError={ui.teamErrors[task.id]}
                uploadError={ui.uploadErrors[task.id]}
                downloadingAttachmentId={ui.downloadingAttachmentId}
                uploadingTaskId={ui.uploadingTaskId}
                onStatusChange={(s) => handleTaskUpdate(task.id, { status: s })}
                onDeadlineChange={(v) => ui.setDeadlineDraft(task.id, v)}
                onDeadlineSave={async () => {
                  const d = ui.deadlineDrafts[task.id]
                  await handleTaskUpdate(task.id, {
                    deadline: d ? `${d}T00:00:00.000Z` : null,
                  })
                }}
                onAssigneeChange={(id) =>
                  handleTaskUpdate(task.id, {
                    assigneeId: id === 'unassigned' ? null : id,
                  })
                }
                onTeamReset={() =>
                  ui.setTeamDraft(
                    task.id,
                    (task.assignments ?? []).map((m) => ({ ...m })),
                  )
                }
                onTeamSave={() => handleTeamSave(task.id)}
                onTeamAddMember={(uid) => handleTeamAddMember(task.id, uid)}
                onTeamRemoveMember={(uid) =>
                  handleTeamRemoveMember(task.id, uid)
                }
                onReviewAction={(action) =>
                  handleTaskUpdate(task.id, { reviewAction: action })
                }
                onFileUpload={(f) => handleFileUpload(task.id, f)}
                onFileDownload={(att) => handleFileDownload(att)}
              />
            ))
          )}
        </div>

        {/* Load More */}
        {nextCursor && !loading && (
          <div className="flex justify-center pt-4">
            <Button
              variant="outline"
              onClick={() =>
                fetchTasks(telegramInitDataRef.current!, nextCursor)
              }
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <div className="border-primary mr-2 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
                  Загрузка...
                </>
              ) : (
                'Загрузить ещё'
              )}
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
