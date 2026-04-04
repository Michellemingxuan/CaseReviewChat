import { useEffect } from 'react'
import { useStore } from './store'
import { fetchCaseList } from './api'
import { Sidebar } from './components/Sidebar/Sidebar'
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

  const consumerCases = caseList.filter((id) => id.startsWith('C-'))
  const commercialCases = caseList.filter((id) => id.startsWith('M-'))

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        consumerCases={consumerCases}
        commercialCases={commercialCases}
        activeCase={activeCase}
        unread={unread}
        onSelect={setActiveCase}
      />
      <div style={{ flex: 1, background: 'var(--bg-white)' }}>
        {/* ChatPanel — Task 6 */}
      </div>
    </div>
  )
}

export default App
