import { useEffect } from 'react'
import { useStore } from './store'
import { fetchCaseList } from './api'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ChatPanel } from './components/ChatPanel/ChatPanel'
import './index.css'

function App() {
  const caseList = useStore((s) => s.caseList)
  const activeCase = useStore((s) => s.activeCase)
  const unread = useStore((s) => s.unread)
  const setCaseList = useStore((s) => s.setCaseList)
  const setActiveCase = useStore((s) => s.setActiveCase)

  useEffect(() => {
    fetchCaseList().then(setCaseList).catch(console.error)
  }, [setCaseList])

  const consumerCases = caseList?.consumer ?? []
  const commercialCases = caseList?.commercial ?? []

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        consumerCases={consumerCases}
        commercialCases={commercialCases}
        activeCase={activeCase}
        unread={unread}
        onSelect={setActiveCase}
      />
      <ChatPanel />
    </div>
  )
}

export default App
