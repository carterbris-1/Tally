import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { store } from './db/store'
import { startSyncLoop } from './db/sync'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

store
  .load()
  .catch((err: unknown) => {
    // A browser with IndexedDB blocked (private windows, locked-down settings) must
    // still render rather than showing a blank page.
    console.error('Tally failed to open its database', err)
  })
  .finally(() => {
    startSyncLoop()
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline shell is a nicety; failing to register is not fatal */
    })
  })
}
