'use client'

import { useState, useEffect, useMemo } from 'react'
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

interface TasksResponse {
  tasks: Task[]
  user: UserPayload
  employees: EmployeeOption[]
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  PAUSED: 'Paused',
  OVERDUE: 'Overdue',
  CLOSED: 'Closed',
}

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

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              Please open this application from within Telegram.
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
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>
              Your Telegram account is not whitelisted for this workspace.
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
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{fetchError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => fetchTasks((globalThis.window as any).Telegram.WebApp.initData)}>
              Retry
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
          <h1 className="text-2xl font-bold">Task Manager</h1>
          {currentUser && (
            <Badge variant="outline">{isManager ? 'Manager' : 'Employee'}</Badge>
          )}
        </div>
        {currentUser?.name && (
          <p className="text-muted-foreground text-sm">Signed in as {currentUser.name}</p>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          onClick={() => fetchTasks((globalThis.window as any).Telegram.WebApp.initData)}
          disabled={loading}
          className="self-start"
        >
          Refresh
        </Button>

        {isManager && (
          <label className="flex flex-col gap-2 w-full sm:w-64 text-sm">
            <span className="text-muted-foreground">Filter by assignee</span>
            <select
              className="border rounded-md px-3 py-2 bg-background"
              value={selectedAssignee}
              onChange={(event) => setSelectedAssignee(event.target.value)}
            >
              <option value="all">All employees</option>
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
              <p className="text-center text-muted-foreground py-8">No tasks found.</p>
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
                      <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                      {task.deadline && (
                        <span className="flex items-center gap-2">
                          Deadline: {new Date(task.deadline).toLocaleDateString()}
                          {new Date(task.deadline) < new Date() && task.status !== 'DONE' && (
                            <Badge variant="destructive" className="text-xs">Overdue</Badge>
                          )}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap mb-4">{task.description}</p>
                    <div className="text-sm text-muted-foreground space-y-1 mb-4">
                      <p>Creator: {task.creatorName ?? 'Unknown'}</p>
                      <p>Assignee: {task.assigneeName ?? 'Not assigned'}</p>
                    </div>
                    {task.subtasks && Array.isArray(task.subtasks) && task.subtasks.length > 0 && (
                      <div className="bg-muted p-3 rounded-md text-sm">
                        <p className="font-semibold mb-2">Subtasks:</p>
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
