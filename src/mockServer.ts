import express from 'express'
import cors from 'cors'
import type { Response } from 'express'

const app = express()
app.use(cors())
app.use(express.json())

const CASES = { consumer: ['7891', '4523', '2847'], commercial: ['1892', '5671'] }

// SSE clients per case: caseId -> list of active response streams
const clients: Record<string, Response[]> = {}

function broadcast(caseId: string, role: 'agent' | 'reviewer', text: string) {
  const msg = {
    id: crypto.randomUUID(),
    role,
    text,
    timestamp: Date.now(),
  }
  const payload = `event: message\ndata: ${JSON.stringify(msg)}\n\n`
  for (const res of clients[caseId] ?? []) {
    res.write(payload)
  }
}

app.get('/api/cases', (_req, res) => {
  res.json(CASES)
})

app.get('/api/cases/:id/stream', (req, res) => {
  const { id } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Register this client
  if (!clients[id]) clients[id] = []
  clients[id].push(res)
  console.log(`[SSE] Client connected to case ${id} (total: ${clients[id].length})`)

  res.write(': connected\n\n')

  req.on('close', () => {
    clients[id] = (clients[id] ?? []).filter((c) => c !== res)
  })
})

app.post('/api/cases/:id/message', (req, res) => {
  const { id } = req.params
  const { text } = req.body
  console.log(`[${id}] Reviewer: ${text} | SSE clients: ${(clients[id] ?? []).length}`)
  broadcast(id, 'reviewer', text)
  res.sendStatus(204)
  // Fallback reply — replace this with real agentic system call
  setTimeout(() => {
    broadcast(id, 'agent', 'The system is under construction.')
  }, 1500)
})

app.post('/api/cases/:id/rewind', (req, res) => {
  console.log(`[${req.params.id}] Rewind to: ${req.body.messageId}`)
  res.sendStatus(204)
})

app.listen(3001, () => console.log('Mock server on http://localhost:3001'))
