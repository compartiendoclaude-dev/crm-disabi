'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const router = useRouter()
  const sb = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')

    const { error: signInError } = await sb.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError('Correo o contraseña incorrectos.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--surf)', border: '1px solid var(--bdr)',
        borderRadius: 'var(--r-lg)', padding: '40px 36px',
        width: '100%', maxWidth: 400, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.3px' }}>
            DISABI ERP
          </h1>
          <p style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 4 }}>
            Sistema operativo interno
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <label>CORREO ELECTRÓNICO</label>
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              required autoComplete="email"
            />
          </div>
          <div className="field">
            <label>CONTRASEÑA</label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)',
              borderRadius: 'var(--r)', padding: '10px 12px',
              fontSize: 12, color: 'var(--red)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: 11, marginTop: 4 }}>
            {loading ? '⏳ Verificando...' : 'Ingresar al sistema'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--txt3)', marginTop: 24 }}>
          Acceso restringido — solo personal autorizado
        </p>
      </div>
    </div>
  )
}
