import { Workspace } from './components/Workspace/Workspace'
import { JourneyShell } from './journey/JourneyShell'
import './index.css'

/**
 * The journey UI is the default shell. The classic three-panel workspace
 * stays reachable at `?classic=1` until the journey shell reaches parity —
 * it is the only way to use the app today, and deleting it before its
 * replacement is finished would leave no working UI on this branch.
 *
 * Read once at module scope: switching shells mid-session would tear down
 * the SSE connection, and the flag is a developer affordance, not a
 * runtime toggle.
 */
const useClassic = new URLSearchParams(window.location.search).has('classic')

function App() {
  return useClassic ? <Workspace /> : <JourneyShell />
}

export default App
