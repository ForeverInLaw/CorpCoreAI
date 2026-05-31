'use client'

import { useState, useRef } from 'react'
import { 
  Clock, 
  MoreVertical, 
  Paperclip, 
  User, 
  CheckCircle2, 
  AlertCircle,
  FileText,
  Shield,
  X
} from 'lucide-react'

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
  Attachment
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

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: typeof Clock }> = {
  IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-500/10 text-blue-600 border-blue-200', icon: Clock },
  DONE: { label: 'Done', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', icon: CheckCircle2 },
  PAUSED: { label: 'Paused', color: 'bg-amber-500/10 text-amber-600 border-amber-200', icon: AlertCircle },
  OVERDUE: { label: 'Overdue', color: 'bg-red-500/10 text-red-600 border-red-200', icon: AlertCircle },
  CLOSED: { label: 'Closed', color: 'bg-slate-100 text-slate-500 border-slate-200', icon: X },
}

export function TaskCard({
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
  onFileDownload
}: TaskCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const statusConfig = STATUS_CONFIG[task.status]
  const StatusIcon = statusConfig.icon
  
  const availableEmployeesForTask = employees.filter(
    (employee) => !teamDraft.some((member) => member.userId === employee.id)
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

  return (
    <Card className="group relative border-border/40 bg-card shadow-sm transition-all hover:shadow-md hover:border-border/80">
      <CardHeader className="p-5 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Badge 
                variant="outline" 
                className={cn("flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors", statusConfig.color)}
              >
                <StatusIcon className="h-3 w-3" />
                {statusConfig.label}
              </Badge>
              {task.deadline && (
                <span className={cn(
                  "text-[11px] font-medium flex items-center gap-1",
                  new Date(task.deadline) < new Date() && task.status !== 'DONE' 
                    ? "text-destructive" 
                    : "text-muted-foreground"
                )}>
                  {new Date(task.deadline) < new Date() && task.status !== 'DONE' && <AlertCircle className="h-3 w-3" />}
                  {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(task.deadline))}
                </span>
              )}
            </div>
            <h3 className="font-semibold tracking-tight text-lg leading-snug text-foreground">
              {task.title}
            </h3>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-4 w-4" />
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

      <CardContent className="p-5 pt-2 space-y-4">
        {task.overdueReason && (
          <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive border border-destructive/20">
            <div className="flex items-center gap-1.5 font-medium mb-1">
               <AlertCircle className="h-3.5 w-3.5" />
               Причина просрочки
            </div>
            <p className="opacity-90 leading-relaxed">{task.overdueReason}</p>
          </div>
        )}

        <p className={cn(
          "text-sm text-muted-foreground leading-relaxed",
          !isExpanded && "line-clamp-3"
        )}>
          {task.description}
        </p>

        {/* Compact Tags View */}
        {!isExpanded && task.tags && task.tags.length > 0 && (
           <div className="flex flex-wrap gap-1.5">
             {task.tags.map(tag => (
               <span key={tag.id} className="text-[10px] font-medium text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
                 #{tag.label}
               </span>
             ))}
           </div>
        )}

        {isExpanded && (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="rounded-lg border bg-secondary/10 p-3">
                 <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Подзадачи</h4>
                 <ul className="space-y-1.5">
                   {task.subtasks.map((sub, i) => (
                     <li key={i} className="flex items-start gap-2 text-sm">
                        <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" />
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
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Команда</Label>
                  {isManager && (
                     <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onTeamReset} disabled={isUpdating}>
                          <X className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onTeamSave} disabled={isUpdating}>
                          <CheckCircle2 className="h-3 w-3" />
                        </Button>
                     </div>
                  )}
                </div>
                
                <div className="bg-secondary/20 rounded-lg p-3 space-y-2">
                  {teamDraft.length === 0 ? (
                    <span className="text-sm text-muted-foreground italic">Нет участников</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {teamDraft.map(member => (
                        <Badge 
                          key={member.userId} 
                          variant={member.isLead ? 'default' : 'secondary'}
                          className="pl-1 pr-2 py-1 flex items-center gap-1 hover:bg-primary/20"
                        >
                          {member.isLead && <Shield className="h-3 w-3" />}
                          <span className="text-xs">{member.name}</span>
                          {isManager && (
                            <X 
                              className="h-3 w-3 ml-1 cursor-pointer opacity-50 hover:opacity-100" 
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
                        <SelectTrigger className="h-8 text-xs bg-background">
                          <SelectValue placeholder="Добавить..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableEmployeesForTask.map(emp => (
                            <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {teamError && <p className="text-xs text-destructive">{teamError}</p>}
                </div>
              </div>

              {/* Details & Meta */}
              <div className="space-y-3">
                 <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Детали</Label>
                 <div className="space-y-2">
                    <div className="grid grid-cols-3 items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Статус</span>
                      <Select value={task.status} onValueChange={(v) => onStatusChange(v as TaskStatus)} disabled={isUpdating}>
                        <SelectTrigger className="col-span-2 h-8">
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_CONFIG).map(([key, conf]) => (
                            <SelectItem key={key} value={key}>{conf.label}</SelectItem>
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
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDeadlineSave}><CheckCircle2 className="h-4 w-4" /></Button>
                      </div>
                    </div>

                     {isManager && (
                       <div className="grid grid-cols-3 items-center gap-2 text-sm">
                         <span className="text-muted-foreground">Исполн.</span>
                         <Select value={task.assigneeId ?? ''} onValueChange={onAssigneeChange} disabled={isUpdating}>
                           <SelectTrigger className="col-span-2 h-8">
                             <SelectValue placeholder="Не назначен" />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="unassigned">Не назначен</SelectItem>
                              {employees.map(e => (
                                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
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
              <div className="bg-muted/30 border rounded-lg p-3">
                 <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Ревью выполнения</span>
                    <Badge variant={
                      task.completionReviewStatus === 'APPROVED' ? 'default' : 
                      task.completionReviewStatus === 'REJECTED' ? 'destructive' : 'secondary'
                    }>
                      {task.completionReviewStatus}
                    </Badge>
                 </div>
                 {task.completionReviewStatus === 'PENDING' && isManager && (
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => onReviewAction('APPROVE')} disabled={isUpdating}>Подтвердить</Button>
                      <Button size="sm" variant="destructive" className="flex-1 h-8 text-xs" onClick={() => onReviewAction('REJECT')} disabled={isUpdating}>Отклонить</Button>
                    </div>
                 )}
              </div>
            )}
            
            {/* Attachments */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Вложения</Label>
                {canUpload && (
                   <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => fileInputRef.current?.click()} disabled={uploadingTaskId === task.id}>
                     {uploadingTaskId === task.id ? 'Загрузка...' : '+ Добавить'}
                   </Button>
                )}
                <input 
                  type="file" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={(e) => e.target.files?.[0] && onFileUpload(e.target.files[0])}
                />
              </div>
              
              {task.attachments && task.attachments.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {task.attachments.map(att => (
                    <div key={att.id} className="flex items-center justify-between p-2 bg-background border rounded-md text-sm hover:bg-accent/50 transition-colors">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate font-medium text-xs">{att.fileName || 'Файл'}</span>
                          <span className="text-[10px] text-muted-foreground">{formatFileSize(att.sizeBytes)}</span>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7"
                        onClick={() => onFileDownload(att)}
                        disabled={downloadingAttachmentId === att.id}
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Нет вложений</p>
              )}
              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            </div>

            <Separator />
            
            <TaskHistoryLog history={task.history || []} />

            {updateError && (
              <div className="bg-destructive/10 text-destructive text-xs p-2 rounded-md">
                {updateError}
              </div>
            )}
          </div>
        )}
      </CardContent>
      
      {/* Footer Summary (Always Visible) */}
      {!isExpanded && (
         <CardFooter className="px-5 py-3 bg-muted/10 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
               <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span>{task.assigneeName || 'Не назначен'}</span>
               </div>
               {task.attachments && task.attachments.length > 0 && (
                 <div className="flex items-center gap-1.5">
                   <Paperclip className="h-3.5 w-3.5" />
                   <span>{task.attachments.length}</span>
                 </div>
               )}
            </div>
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs hover:bg-transparent hover:text-primary" onClick={() => setIsExpanded(true)}>
              Подробнее
            </Button>
         </CardFooter>
      )}
    </Card>
  )
}
