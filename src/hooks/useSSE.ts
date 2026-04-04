import { useEffect } from 'react'
import { openSSE } from '../api'
import { useStore } from '../store'
import type { Message } from '../types'

export function useSSE(caseId: string | null) {
  const appendMessage = useStore((s) => s.appendMessage)
  const setSseStatus = useStore((s) => s.setSseStatus)

  useEffect(() => {
    if (!caseId) return

    const es = openSSE(caseId)

    es.onopen = () => {
      setSseStatus('connected')
    }

    es.onmessage = (event: MessageEvent) => {
      try {
        const msg: Message = JSON.parse(event.data)
        appendMessage(caseId, msg)
      } catch {
        console.error('Failed to parse SSE message', event.data)
        setSseStatus('disconnected')
      }
    }

    es.onerror = () => {
      setSseStatus('disconnected')
    }

    return () => {
      es.close()
      setSseStatus('disconnected')
    }
  }, [caseId, appendMessage, setSseStatus])
}
