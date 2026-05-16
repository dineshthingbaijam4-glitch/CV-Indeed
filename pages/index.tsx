import { useState, useRef } from 'react'
import Head from 'next/head'

type Candidate = {
  name: string
  fileName: string
  driveUrl: string
  uploadedAt: string
  size: string
}

type Step = 'setup' | 'running' | 'done'

export default function Home() {
  const [step, setStep] = useState<Step>('setup')
  const [cookies, setCookies] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [driveFolder, setDriveFolder] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = (msg: string) => {
    setLogs(prev => {
      const next = [...prev, msg]
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, 50)
      return next
    })
  }

  const handleRun = async () => {
    if (!cookies.trim() || !jobUrl.trim() || !driveFolder.trim()) {
      setError('Please fill in all three fields.')
      return
    }
    setError('')
    setStep('running')
    setLogs(['⚡ Starting...'])

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies, jobUrl, driveFolder }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      if (!reader) throw new Error('No response stream')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('LOG:')) addLog(line.slice(4).trim())
          if (line.startsWith('RESULT:')) {
            setCandidates(JSON.parse(line.slice(7)))
            setStep('done')
          }
          if (line.startsWith('ERROR:')) {
            setError(line.slice(6).trim())
            setStep('setup')
          }
        }
      }
    } catch (e: any) {
      setError(e.message)
      setStep('setup')
    }
  }

  const filtered = candidates.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.fileName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <Head><title>Indeed CV Downloader</title></Head>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ borderBottom: '1px solid var(--border)', padding: '18px 36px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 34, height: 34, background: 'var(--accent)', borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 18 }}>📥</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>Indeed CV Downloader</h1>
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 3 }}>Indeed → Google Drive → Database</div>
          </div>
          {step === 'done' && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ background: '#3ecf8e22', color: 'var(--green)', border: '1px solid #3ecf8e44', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>
                ✅ {candidates.length} CVs saved
              </span>
              <button onClick={() => { setStep('setup'); setCandidates([]); setLogs([]) }}
                style={ghostBtn}>+ New Run</button>
            </div>
          )}
        </header>

        <main style={{ flex: 1, maxWidth: 860, width: '100%', margin: '0 auto', padding: '36px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          {step === 'setup' && (
            <>
              {error && <div style={{ background: '#1a0808', border: '1px solid #ef444466', borderRadius: 10, padding: '12px 16px', color: '#ef4444', fontSize: 13 }}>⚠ {error}</div>}
              <div style={card}>
                <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📋 How to get your Indeed session cookies</div>
                <ol style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 13, lineHeight: 2.1 }}>
                  <li>Log in to <b style={{ color: 'var(--text)' }}>employers.indeed.com</b> in Chrome</li>
                  <li>Press <kbd style={{ background: 'var(--border)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>F12</kbd> → go to <b style={{ color: 'var(--text)' }}>Application</b> tab</li>
                  <li>Click <b style={{ color: 'var(--text)' }}>Cookies</b> → <b style={{ color: 'var(--text)' }}>https://employers.indeed.com</b></li>
                  <li>Right-click any cookie row → <b style={{ color: 'var(--accent2)' }}>Copy All as JSON</b></li>
                  <li>Paste below 👇</li>
                </ol>
              </div>
              <Field label="Indeed Session Cookies (JSON)" hint="Paste the copied JSON array from DevTools">
                <textarea value={cookies} onChange={e => setCookies(e.target.value)}
                  placeholder='[{"name":"CTK","value":"..."},...]'
                  style={{ ...input, height: 90, resize: 'vertical', fontSize: 12 }} />
              </Field>
              <Field label="Indeed Job Candidates URL" hint="Navigate to your job → Candidates tab → copy URL">
                <input value={jobUrl} onChange={e => setJobUrl(e.target.value)}
                  placeholder="https://employers.indeed.com/jobs/12345678/candidates"
                  style={input} />
              </Field>
              <Field label="Google Drive Folder ID" hint="Open your Drive folder → copy the ID from the URL after /folders/">
                <input value={driveFolder} onChange={e => setDriveFolder(e.target.value)}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs"
                  style={input} />
              </Field>
              <button onClick={handleRun} style={primaryBtn}>⚡ Download All CVs to Drive</button>
            </>
          )}

          {step === 'running' && (
            <>
              <div>
                <h2 style={{ fontSize: 24, marginBottom: 6 }}>Downloading CVs...</h2>
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>Scraping Indeed and uploading to your Google Drive folder.</p>
              </div>
              <div ref={logRef} style={{ ...card, height: 420, overflowY: 'auto', fontSize: 13, lineHeight: 1.9 }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ color: l.startsWith('✅') ? 'var(--green)' : l.startsWith('❌') ? '#ef4444' : l.startsWith('⬇') ? 'var(--accent2)' : 'var(--muted)' }}>{l}</div>
                ))}
                <span style={{ display: 'inline-block', width: 7, height: 14, background: 'var(--accent)', animation: 'blink 1s step-end infinite', verticalAlign: 'middle', marginLeft: 4 }} />
              </div>
              <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
            </>
          )}

          {step === 'done' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 24 }}>CV Database</h2>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{candidates.length} candidates</span>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍  Search by name or file..."
                  style={{ ...input, marginLeft: 'auto', width: 240, padding: '8px 12px', fontSize: 12 }} />
              </div>
              <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div style={tRow('#1a1a28')}>
                  <div style={{ ...tCell, flex: '0 0 36px', color: 'var(--muted)', fontSize: 12 }}>#</div>
                  <div style={{ ...tCell, flex: 2, color: 'var(--muted)', fontSize: 12 }}>NAME</div>
                  <div style={{ ...tCell, flex: 2, color: 'var(--muted)', fontSize: 12 }}>FILE</div>
                  <div style={{ ...tCell, flex: 1, color: 'var(--muted)', fontSize: 12 }}>SIZE</div>
                  <div style={{ ...tCell, flex: 1, color: 'var(--muted)', fontSize: 12 }}>UPLOADED</div>
                  <div style={{ ...tCell, flex: '0 0 80px', color: 'var(--muted)', fontSize: 12 }}>CV</div>
                </div>
                {filtered.length === 0 && (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No results found.</div>
                )}
                {filtered.map((c, i) => (
                  <div key={i} style={{ ...tRow(i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)') }}
                    onMouseOver={e => (e.currentTarget.style.background = '#22223a')}
                    onMouseOut={e => (e.currentTarget.style.background = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)')}>
                    <div style={{ ...tCell, flex: '0 0 36px', color: 'var(--muted)', fontSize: 12 }}>{i + 1}</div>
                    <div style={{ ...tCell, flex: 2, fontWeight: 600, fontFamily: 'Syne' }}>{c.name}</div>
                    <div style={{ ...tCell, flex: 2, color: 'var(--muted)', fontSize: 12 }}>{c.fileName}</div>
                    <div style={{ ...tCell, flex: 1, color: 'var(--muted)', fontSize: 12 }}>{c.size}</div>
                    <div style={{ ...tCell, flex: 1, color: 'var(--muted)', fontSize: 12 }}>{c.uploadedAt}</div>
                    <div style={{ ...tCell, flex: '0 0 80px' }}>
                      <a href={c.driveUrl} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none', border: '1px solid var(--accent)44', padding: '3px 10px', borderRadius: 6 }}>
                        Open ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <details style={{ fontSize: 12, color: 'var(--muted)' }}>
                <summary style={{ cursor: 'pointer', marginBottom: 8 }}>View run logs ({logs.length} lines)</summary>
                <div style={{ ...card, fontSize: 12, lineHeight: 1.9, maxHeight: 240, overflowY: 'auto' }}>
                  {logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </details>
            </>
          )}
        </main>
      </div>
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13 }}>{label}</label>
      {hint && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{hint}</div>}
      {children}
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
}
const input: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '11px 14px',
  color: 'var(--text)',
  fontFamily: 'DM Mono, monospace',
  fontSize: 13,
  outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  background: 'var(--accent)',
  border: 'none',
  color: '#fff',
  padding: '13px 26px',
  borderRadius: 10,
  cursor: 'pointer',
  fontFamily: 'Syne, sans-serif',
  fontWeight: 700,
  fontSize: 15,
  alignSelf: 'flex-start',
}
const ghostBtn: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '8px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'DM Mono, monospace',
  fontSize: 12,
}
const tRow = (bg: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  padding: '12px 18px',
  background: bg,
  borderBottom: '1px solid var(--border)',
})
const tCell: React.CSSProperties = {
  paddingRight: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
}
