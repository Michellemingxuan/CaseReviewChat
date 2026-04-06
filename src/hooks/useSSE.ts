import { useEffect, useRef } from 'react'
import { openSSE } from '../api'
import { useStore } from '../store'
import type { Message } from '../types'

const RECONNECT_DELAY_MS = 2000

export function useSSE(caseId: string | null) {
  const appendMessage = useStore((s) => s.appendMessage)
  const setSseStatus = useStore((s) => s.setSseStatus)
  const esRef = useRef<EventSource | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    if (!caseId) return

    activeRef.current = true

    function connect() {
      if (!activeRef.current) return

      const es = openSSE(caseId!)
      esRef.current = es

      es.onopen = () => setSseStatus('connected')

      es.onmessage = (event: MessageEvent) => {
        try {
          const msg: Message = JSON.parse(event.data)
          appendMessage(caseId!, msg)
        } catch {
          console.error('Failed to parse SSE message', event.data)
        }
      }

      es.onerror = () => {
        setSseStatus('disconnected')
        es.close()
        esRef.current = null
        if (activeRef.current) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      esRef.current?.close()
      esRef.current = null
      setSseStatus('disconnected')
    }
  }, [caseId, appendMessage, setSseStatus])
}
