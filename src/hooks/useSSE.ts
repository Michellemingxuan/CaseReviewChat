import { useEffect, useRef } from 'react'
import { openSSE } from '../api'
import { useStore } from '../store'
import type { Message } from '../types'

export function useSSE(caseId: string | null) {
  const appendMessage = useStore((s) => s.appendMessage)
  const setSseStatus = useStore((s) => s.setSseStatus)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!caseId) return

    const es = openSSE(caseId)
    esRef.current = es

    es.onmessage = (event: MessageEvent) => {
      try {
        const msg: Message = JSON.parse(event.data)
        setSseStatus('connected')
        appendMessage(caseId, msg)
      } catch {
        console.error('Failed to parse SSE message', event.data)
      }
    }

    es.onerror = () => {
      setSseStatus('disconnected')
    }

    return () => {
      es.close()
      esRef.current = null
      setSseStatus('disconnected')
    }
  }, [caseId, appendMessage, setSseStatus])
}
