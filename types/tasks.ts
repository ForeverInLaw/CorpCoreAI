export type TaskStatus = 'IN_PROGRESS' | 'DONE' | 'PAUSED' | 'OVERDUE' | 'CLOSED'

export type TaskCompletionReviewStatus = 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED'

export type TaskHistoryType =
  | 'STATUS_CHANGE'
  | 'DEADLINE_CHANGE'
  | 'ASSIGNEE_CHANGE'
  | 'OVERDUE_REASON'
  | 'TEAM_CHANGE'
  | 'TAG_CHANGE'
  | 'PROJECT_CHANGE'
  | 'REVIEW_STATUS_CHANGE'

export interface TagOption {
  id: number
  label: string
  color: string | null
}

export interface ProjectOption {
  id: number
  name: string
  color: string | null
}

export interface TaskAssignmentMember {
  userId: string
  name: string
  isLead: boolean
}

export interface TaskHistoryEntry {
  id: string
  type: TaskHistoryType
  details?: Record<string, unknown> | null
  createdAt: string
  actorId: string | null
  actorName: string | null
}

export interface Attachment {
  id: string
  url: string
  type: string
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  createdAt: string
}

export interface Task {
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

export interface UserPayload {
  id: string
  role: 'EMPLOYEE' | 'MANAGER'
  name?: string | null
}

export interface EmployeeOption {
  id: string
  name: string
}

export interface TasksResponse {
  tasks: Task[]
  user: UserPayload
  employees: EmployeeOption[]
  availableTags?: TagOption[]
  availableProjects?: ProjectOption[]
}
