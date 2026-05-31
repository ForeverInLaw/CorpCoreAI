'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { 
  IconSearch, 
  IconRefresh, 
  IconBriefcase,
  IconLogout,
  IconUser as UserIcon
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TaskCard } from '@/components/TaskCard'

import type { 
  Task, 
  TaskStatus, 
  UserPayload, 
  EmployeeOption, 
  TaskAssignmentMember, 
  Attachment,
  TasksResponse
} from '@/types/tasks'

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TaskStatus>('IN_PROGRESS')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [currentUser, setCurrentUser] = useState<UserPayload | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  
  // Filters
  const [selectedAssignee, setSelectedAssignee] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Errors & Status
  const [accessDenied, setAccessDenied] = useState(false)
  
  // Drafts & Ops State
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null)
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null)
  const [, setDownloadErrors] = useState<Record<string, string>>({})
  const [deadlineDrafts, setDeadlineDrafts] = useState<Record<string, string>>({})
  const [updatingTasks, setUpdatingTasks] = useState<Record<string, boolean>>({})
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({})
  const [teamDrafts, setTeamDrafts] = useState<Record<string, TaskAssignmentMember[]>>({})
  const [teamErrors, setTeamErrors] = useState<Record<string, string>>({})
  
  const telegramInitDataRef = useRef<string | null>(null)

  useEffect(() => {
    // Strict production check: Must be inside Telegram WebApp
    if (globalThis.window !== undefined && (globalThis.window as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp) {
      const tg = (globalThis.window as unknown as { Telegram: { WebApp: { ready: () => void; expand: () => void; initData: string } } }).Telegram.WebApp
      tg.ready()
      tg.expand() 

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

  const fetchTasks = async (initData: string, cursor?: string) => {
    if (!cursor) setLoading(true)
    else setLoadingMore(true)
    telegramInitDataRef.current = initData
    try {
      const url = cursor ? `/api/tasks?cursor=${cursor}` : '/api/tasks'
      const res = await fetch(url, {
        headers: { 'Authorization': initData }
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
          setTasks((prev) => [...prev, ...data.tasks])
        } else {
          setTasks(data.tasks)
          setCurrentUser(data.user)
          setEmployees(data.employees ?? [])
        }
        setNextCursor(data.nextCursor)

        // Initialize Drafts for new tasks
        const dDraftsUpdate: Record<string, string> = {}
        const tDraftsUpdate: Record<string, TaskAssignmentMember[]> = {}

        data.tasks.forEach((task) => {
          dDraftsUpdate[task.id] = task.deadline ? task.deadline.slice(0, 10) : ''
          tDraftsUpdate[task.id] = (task.assignments ?? []).map((member) => ({ ...member }))
        })

        setDeadlineDrafts((prev) => ({ ...prev, ...dDraftsUpdate }))
        setTeamDrafts((prev) => ({ ...prev, ...tDraftsUpdate }))
      } else {
        // Non-OK response
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // --- Handlers (Refactored for props) ---

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
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update task')
      }

      await fetchTasks(telegramInitDataRef.current)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update task'
      setUpdateErrors((prev) => ({ ...prev, [taskId]: message }))
    } finally {
      setUpdatingTasks((prev) => ({ ...prev, [taskId]: false }))
    }
  }

  // ... (Simplified wrappers for TaskCard) ...

  const handleFileUpload = async (taskId: string, file: File) => {
    if (!telegramInitDataRef.current) return
    setUploadingTaskId(taskId)
    setUploadErrors((prev) => ({ ...prev, [taskId]: '' }))

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
      setUploadErrors((prev) => ({ ...prev, [taskId]: 'Ошибка загрузки' }))
    } finally {
      setUploadingTaskId(null)
    }
  }

  const requestDownloadUrl = async (attachmentId: string) => {
    if (!telegramInitDataRef.current) throw new Error('Auth missing')
    const response = await fetch(`/api/attachments/${attachmentId}/token`, {
      method: 'POST',
      headers: { Authorization: telegramInitDataRef.current },
    })
    if (!response.ok) throw new Error('Failed to link')
    const data = await response.json()
    return data.url ?? `/api/attachments/download/${data.token}`
  }

  const handleFileDownload = async (attachment: Attachment) => {
    try {
      setDownloadingAttachmentId(attachment.id)
      const url = await requestDownloadUrl(attachment.id)
      window.open(url, '_blank')
    } catch {
      setDownloadErrors(prev => ({...prev, [attachment.id]: 'Ошибка скачивания'}))
    } finally {
      setDownloadingAttachmentId(null)
    }
  }

  // --- Team Logic (Ported) ---
  const updateTeamDraft = (taskId: string, updater: (current: TaskAssignmentMember[]) => TaskAssignmentMember[]) => {
    setTeamDrafts((prev) => ({ ...prev, [taskId]: updater(prev[taskId] ?? []) }))
  }
  
  const handleTeamAddMember = (taskId: string, userId: string) => {
     const emp = employees.find(e => e.id === userId); if(!emp) return;
     updateTeamDraft(taskId, curr => curr.some(m => m.userId === userId) ? curr : [...curr, { userId, name: emp.name, isLead: curr.length === 0 }])
  }
  
  const handleTeamSave = async (taskId: string) => {
    const draft = teamDrafts[taskId] ?? []
    if (draft.length === 0) return setTeamErrors(p => ({...p, [taskId]: 'Нужен хотя бы 1 участник'}))
    if (!draft.some(m => m.isLead)) return setTeamErrors(p => ({...p, [taskId]: 'Выберите лидера'}))
    await handleTaskUpdate(taskId, { assignments: draft.map(m => ({ userId: m.userId, isLead: m.isLead })) })
  }

  // --- Filter Logic ---
  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchStatus = task.status === activeTab
      const matchAssignee = selectedAssignee === 'all' || task.assigneeId === selectedAssignee
      const matchSearch = normalizedQuery
        ? [task.title, task.description].some(f => f?.toLowerCase().includes(normalizedQuery))
        : true
      return matchStatus && matchAssignee && matchSearch
    })
  }, [tasks, activeTab, selectedAssignee, searchQuery])

  const isManager = currentUser?.role === 'MANAGER'

  // --- Render ---

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground animate-pulse">Загрузка задач...</p>
    </div>
  )

  if (!isAuthorized || accessDenied) return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="text-center space-y-4 max-w-sm">
         <div className="h-12 w-12 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto">
            <IconLogout className="h-6 w-6" />
         </div>
         <h2 className="text-xl font-bold">Доступ ограничен</h2>
         <p className="text-muted-foreground text-sm">
           {accessDenied ? 'Ваш аккаунт не имеет прав доступа.' : 'Пожалуйста, откройте приложение через Telegram.'}
         </p>
      </div>
    </div>
  )

  const tabs: {id: TaskStatus, label: string}[] = [
    { id: 'IN_PROGRESS', label: 'В работе' },
    { id: 'DONE', label: 'Готово' },
    { id: 'PAUSED', label: 'На паузе' },
    { id: 'OVERDUE', label: 'Просрочено' },
    { id: 'CLOSED', label: 'Архив' },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
           <div className="flex items-center gap-2">
             <div className="h-8 w-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center font-bold text-lg tracking-tighter">
               C
             </div>
             <span className="font-semibold tracking-tight hidden sm:inline-block">CorpCoreAI</span>
           </div>
           
           <div className="flex items-center gap-3">
              {currentUser && (
                 <div className="flex items-center gap-2 bg-secondary/50 pl-3 pr-1.5 py-1 rounded-full border border-border/50">
                    <div className="flex flex-col items-end leading-none">
                       <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                         {isManager ? 'Менеджер' : 'Сотрудник'}
                       </span>
                       <span className="text-xs font-semibold truncate max-w-[80px]">{currentUser.name?.split(' ')[0]}</span>
                    </div>
                    <div className="h-7 w-7 bg-background rounded-full flex items-center justify-center shadow-sm">
                       <UserIcon className="h-4 w-4 text-primary" />
                    </div>
                 </div>
              )}
              <Button variant="ghost" size="icon" onClick={() => fetchTasks(telegramInitDataRef.current!)}>
                 <IconRefresh className="h-4 w-4" />
              </Button>
           </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 space-y-8">
        
        {/* Hero / Greeting */}
        <div className="space-y-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-light tracking-tight text-foreground">
            Добрый день, <span className="font-semibold">{currentUser?.name?.split(' ')[0]}</span>.
          </h1>
          <p className="text-muted-foreground">
            У вас <span className="text-foreground font-medium">{tasks.filter(t => t.status === 'IN_PROGRESS').length}</span> активных задач сегодня.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col lg:flex-row gap-4 sticky top-14 z-30 bg-background/95 backdrop-blur py-4 -mx-4 px-4 border-b border-border/40 lg:static lg:bg-transparent lg:p-0 lg:border-0 lg:items-center lg:justify-between">
           {/* Tabs: Wrap on all screens */}
           <div className="flex gap-2 flex-wrap">
             {tabs.map(tab => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id)}
                 className={`
                   flex-shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200 border
                   ${activeTab === tab.id 
                     ? 'bg-primary text-primary-foreground border-primary shadow-md' 
                     : 'bg-background text-muted-foreground border-border hover:border-primary/30 hover:bg-secondary/50'}
                 `}
               >
                 {tab.label}
                 <span className={`ml-2 text-[10px] py-0.5 px-1.5 rounded-full ${activeTab === tab.id ? 'bg-primary-foreground/20' : 'bg-secondary'}`}>
                    {tasks.filter(t => t.status === tab.id).length}
                 </span>
               </button>
             ))}
           </div>

           {/* Filters */}
           <div className="flex gap-2 w-full lg:w-auto">
              <div className="relative flex-1 lg:w-64">
                <IconSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Поиск..." 
                  className="pl-9 bg-secondary/30 border-transparent focus:bg-background transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {isManager && (
                 <Select
                   value={selectedAssignee}
                   onValueChange={setSelectedAssignee}
                 >
                   <SelectTrigger className="w-10 sm:w-[180px] px-0 sm:px-3 justify-center sm:justify-between">
                      <div className="hidden sm:block truncate">
                         <SelectValue placeholder="Все" />
                      </div>
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="all">Все сотрудники</SelectItem>
                     {employees.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              )}
           </div>
        </div>

        {/* Task Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredTasks.length === 0 ? (
             <div className="col-span-full flex flex-col items-center justify-center py-12 text-center space-y-4 opacity-50">
                <IconBriefcase className="h-12 w-12" strokeWidth={1} />
                <p>Задач не найдено</p>
             </div>
          ) : (
            filteredTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                currentUser={currentUser}
                employees={employees}
                isManager={isManager}
                
                // State Props
                teamDraft={teamDrafts[task.id] ?? []}
                deadlineDraft={deadlineDrafts[task.id] ?? ''}
                
                // Status
                isUpdating={!!updatingTasks[task.id]}
                updateError={updateErrors[task.id]}
                teamError={teamErrors[task.id]}
                uploadError={uploadErrors[task.id]}
                downloadingAttachmentId={downloadingAttachmentId}
                uploadingTaskId={uploadingTaskId}

                // Handlers
                onStatusChange={(s) => handleTaskUpdate(task.id, { status: s })}
                onDeadlineChange={(v) => setDeadlineDrafts(p => ({...p, [task.id]: v}))}
                onDeadlineSave={async () => {
                   const d = deadlineDrafts[task.id]; 
                   await handleTaskUpdate(task.id, { deadline: d ? `${d}T00:00:00.000Z` : null })
                }}
                onAssigneeChange={(id) => handleTaskUpdate(task.id, { assigneeId: id === 'unassigned' ? null : id })}
                
                onTeamReset={() => setTeamDrafts(p => ({...p, [task.id]: (task.assignments ?? []).map(m => ({...m}))}))}
                onTeamSave={() => handleTeamSave(task.id)}
                onTeamAddMember={(uid) => handleTeamAddMember(task.id, uid)}
                onTeamRemoveMember={(uid) => updateTeamDraft(task.id, curr => curr.filter(m => m.userId !== uid))}
                
                onReviewAction={(action) => handleTaskUpdate(task.id, { reviewAction: action })}
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
              onClick={() => fetchTasks(telegramInitDataRef.current!, nextCursor!)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
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