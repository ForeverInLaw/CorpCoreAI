'use client'

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  deadline: string | null
  subtasks: string[] | null
  createdAt: string
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('IN_PROGRESS')
  const [isAuthorized, setIsAuthorized] = useState(false)

  useEffect(() => {
    // Strict production check: Must be inside Telegram WebApp
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp
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
    try {
      const res = await fetch(`/api/tasks`, {
        headers: {
          'Authorization': initData
        }
      })
      if (res.ok) {
        const data = await res.json()
        setTasks(data)
      } else {
        console.error('Failed to fetch tasks')
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const filteredTasks = tasks.filter(t => t.status === activeTab)

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

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Task Manager</h1>

      <div className="mb-6 flex justify-end">
        <Button onClick={() => fetchTasks((window as any).Telegram.WebApp.initData)} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="IN_PROGRESS" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="IN_PROGRESS">In Progress</TabsTrigger>
          <TabsTrigger value="DONE">Done</TabsTrigger>
          <TabsTrigger value="OVERDUE">Overdue</TabsTrigger>
        </TabsList>

        {['IN_PROGRESS', 'DONE', 'OVERDUE'].map((status) => (
          <TabsContent key={status} value={status} className="mt-4 space-y-4">
            {filteredTasks.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No tasks found.</p>
            ) : (
              filteredTasks.map(task => (
                <Card key={task.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg">{task.title}</CardTitle>
                      <Badge variant={status === 'DONE' ? 'default' : 'secondary'}>{status}</Badge>
                    </div>
                    <CardDescription>{new Date(task.createdAt).toLocaleDateString()}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap mb-4">{task.description}</p>
                    {task.subtasks && Array.isArray(task.subtasks) && task.subtasks.length > 0 && (
                      <div className="bg-muted p-3 rounded-md text-sm">
                        <p className="font-semibold mb-2">Subtasks:</p>
                        <ul className="list-disc list-inside space-y-1">
                          {task.subtasks.map((sub: string, i: number) => (
                            <li key={i}>{sub}</li>
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
