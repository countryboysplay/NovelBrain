import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource/permanent-marker'
import '@fontsource/opendyslexic/400.css'
import './styles.css' // the setup wizard's look first; the studio sheets after it win their ties
import './styles/tokens.css'
import './styles/motion.css'
import './styles/views.css'
import './styles/shell.css'
import { App } from './App'

// No StrictMode: its double-invoked effects would start two tool updates and double-subscribe the PTY.
createRoot(document.getElementById('root')!).render(<App />)
