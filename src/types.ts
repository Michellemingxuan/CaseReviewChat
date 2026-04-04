export type Message = {
  id: string
  role: 'agent' | 'reviewer'
  text: string
  timestamp: number
}

export type SseStatus = 'connected' | 'disconnected'

export type StoreState = {
  caseList: string[]
  activeCase: string | null
  threads: Record<string, Message[]>
  sseStatus: SseStatus
  unread: Set<string>
  // actions
  setCaseList: (ids: string[]) => void
  setActiveCase: (id: string) => void
  appendMessage: (caseId: string, msg: Message) => void
  rewindThread: (caseId: string, messageId: string) => void
  setSseStatus: (status: SseStatus) => void
  markUnread: (caseId: string) => void
}
