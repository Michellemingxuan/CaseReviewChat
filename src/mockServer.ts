import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const CASES = ['C-7891', 'C-4523', 'C-2847', 'M-1892', 'M-5671']

app.get('/api/cases', (_req, res) => {
  res.json(CASES)
})

// SSE: push a mock agent greeting after 1s, then periodic messages every 15s
app.get('/api/cases/:id/stream', (req, res) => {
  const { id } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (text: string) => {
    const msg = {
      id: crypto.randomUUID(),
      role: 'agent',
      text,
      timestamp: Date.now(),
    }
    res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)
  }

  // Emit onopen equivalent — signal connection established
  res.write(': connected\n\n')

  setTimeout(() => send(`I'm reviewing case ${id}. How can I help?`), 1000)

  const timer = setInterval(() => {
    send(`[${new Date().toLocaleTimeString()}] Agent is monitoring case ${id}...`)
  }, 15000)

  req.on('close', () => clearInterval(timer))
})

app.post('/api/cases/:id/message', (req, res) => {
  console.log(`[${req.params.id}] Reviewer: ${req.body.text}`)
  res.sendStatus(204)
})

app.post('/api/cases/:id/rewind', (req, res) => {
  console.log(`[${req.params.id}] Rewind to: ${req.body.messageId}`)
  res.sendStatus(204)
})

app.listen(3001, () => console.log('Mock server on http://localhost:3001'))
