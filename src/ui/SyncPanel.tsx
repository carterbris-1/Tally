import { useEffect, useState, useSyncExternalStore } from 'react'
import { isSyncConfigured } from '../db/supabase'
import { currentEmail, getSyncState, signIn, signOut, subscribeToSync, sync } from '../db/sync'

export function SyncPanel() {
  const state = useSyncExternalStore(subscribeToSync, getSyncState, getSyncState)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentEmail().then(setAccount)
  }, [state])

  if (!isSyncConfigured) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 13.5 }}>
          Sync is not configured on this build. Tally is running local-only, which works
          fully — it just does not reach your other device.
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and
          rebuild. See <code>README.md</code>.
        </div>
      </div>
    )
  }

  const status = (): string => {
    switch (state.status) {
      case 'syncing':
        return 'Syncing…'
      case 'error':
        return `Last attempt failed: ${state.message}`
      case 'signedOut':
        return 'Not signed in. Nothing leaves this device.'
      case 'idle':
        return state.last
          ? `Synced ${new Date(state.last.at).toLocaleTimeString()} · ${state.last.pushed} sent, ${state.last.pulled} received`
          : 'Signed in.'
      default:
        return ''
    }
  }

  const attempt = async (fn: (e: string, p: string) => Promise<string>): Promise<void> => {
    if (!email.trim() || password.length < 6) {
      setMessage('Enter your email and a password of at least 6 characters.')
      return
    }
    setBusy(true)
    setMessage('')
    const result = await fn(email.trim(), password)
    setBusy(false)
    if (result) setMessage(result)
    else {
      setPassword('')
      setAccount(await currentEmail())
    }
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 13.5, marginBottom: 10 }}>
        {account ? <>Signed in as <strong>{account}</strong>.</> : 'Sign in to sync with your other device.'}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 11 }}>{status()}</div>

      {account ? (
        <div className="seg">
          <button className="pill" onClick={() => void sync()}>
            Sync now
          </button>
          <button className="pill" onClick={() => void signOut().then(() => setAccount(null))}>
            Sign out
          </button>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="sync-email">Email</label>
            <input
              id="sync-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="sync-password">Password</label>
            <input
              id="sync-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void attempt(signIn)}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="seg">
            <button className="pill active" disabled={busy} onClick={() => void attempt(signIn)}>
              Sign in
            </button>
          </div>
          {message ? <div className="muted" style={{ fontSize: 12.5, marginTop: 9 }}>{message}</div> : null}
          <div className="muted" style={{ fontSize: 12, marginTop: 9 }}>
            Use the same email and password on your phone — that is what makes the two
            devices one tracker. Let the keychain remember it.
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 7 }}>
            There is no sign-up here. Accounts are created once in the Supabase dashboard.
          </div>
        </>
      )}

      <div className="muted" style={{ fontSize: 12, marginTop: 11 }}>
        Conflicts resolve to whichever edit happened later. Deletes sync as tombstones, so
        deleting on one device removes it on the other.
      </div>
    </div>
  )
}
