import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// ── Rate limit por IP — 20 req/min para el portal (más estricto que el ERP) ──
const portalHits = new Map<string, number[]>()
function rateLimit(ip: string): boolean {
  const now  = Date.now()
  const prev = (portalHits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now)
  portalHits.set(ip, prev)
  return prev.length <= 20
}

// ── GET — validar token + cargar datos (público) o listar tokens (admin) ──────
export async function GET(req: NextRequest) {
  try {
    const ip    = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const ua    = req.headers.get('user-agent') ?? ''
    const sb    = await createClient()
    const url   = new URL(req.url)
    const token = url.searchParams.get('token')

    // ── Acceso público con token ──────────────────────────────────────────────
    if (token) {
      // Rate limit — bloquear IPs que intentan tokens en masa
      if (!rateLimit(ip)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Intenta en un minuto.' },
          { status: 429 }
        )
      }

      // Buscar token válido, activo y no expirado
      const { data: tokenRow } = await sb
        .from('disabi_portal_tokens')
        .select('id, cliente_id, expira_at, activo, cliente:disabi_clientes(id, nombre, email, telefono, sector)')
        .eq('token', token)
        .eq('activo', true)
        .single()

      // Token no existe
      if (!tokenRow) {
        return NextResponse.json({ error: 'Link inválido o revocado.' }, { status: 401 })
      }

      // Token expirado
      const expira = tokenRow.expira_at ? new Date(tokenRow.expira_at) : null
      if (expira && expira < new Date()) {
        return NextResponse.json(
          { error: 'Este link ha expirado. Solicita uno nuevo a DISABI.' },
          { status: 401 }
        )
      }

      const cliente = tokenRow.cliente as unknown as { id: string; nombre: string; email?: string; telefono?: string; sector?: string }

      // Registrar acceso (fire-and-forget — no bloquea la respuesta)
      sb.from('disabi_portal_accesos').insert([{
        token_id:   tokenRow.id,
        cliente_id: tokenRow.cliente_id,
        ip,
        user_agent: ua.slice(0, 300), // truncar UAs muy largos
      }]).then(() => {/* ignorar error — no crítico */})

      // Actualizar último acceso
      sb.from('disabi_portal_tokens')
        .update({ ultimo_acceso: new Date().toISOString() })
        .eq('id', tokenRow.id)
        .then(() => {/* fire-and-forget */})

      const nombre = cliente.nombre

      // Cargar datos del cliente
      const [
        { data: ventas },
        { data: cxcs },
        { data: dtes },
      ] = await Promise.all([
        sb.from('disabi_ventas')
          .select('id, numero, fecha, monto, cobro, metodo_pago, items:disabi_venta_items(descripcion, cantidad, precio_unitario, subtotal)')
          .ilike('nombre', nombre)
          .neq('cobro', 'Borrador')
          .order('fecha', { ascending: false })
          .limit(50),

        sb.from('disabi_cxc')
          .select('id, numero, fecha_emision, fecha_vence, monto, saldo, estado, abonos:disabi_cxc_abonos(monto, fecha, notas)')
          .ilike('cliente', nombre)
          .order('fecha_emision', { ascending: false })
          .limit(20),

        sb.from('disabi_dte')
          .select('id, tipo_dte, numero_control, fecha_emision, total_pagar, estado, sello_recepcion')
          .ilike('receptor_nombre', nombre)
          .order('fecha_emision', { ascending: false })
          .limit(30),
      ])

      const vts     = ventas   ?? []
      const cxcRows = cxcs     ?? []

      const totalComprado  = vts.reduce((a, v) => a + (v.monto ?? 0), 0)
      const saldoPendiente = cxcRows.filter(c => c.estado !== 'Pagado').reduce((a, c) => a + (c.saldo ?? 0), 0)
      const cxcVencidas    = cxcRows.filter(c => c.estado === 'Vencido')

      return NextResponse.json({
        ok: true,
        cliente,
        expira_at: tokenRow.expira_at,
        resumen: {
          totalComprado, saldoPendiente,
          numVentas: vts.length, cxcVencidas: cxcVencidas.length,
        },
        ventas: vts,
        cxcs:   cxcRows,
        dtes:   dtes ?? [],
      })
    }

    // ── Listar tokens — requiere autenticación ──────────────────────────────
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { data: tokens } = await sb
      .from('disabi_portal_tokens')
      .select('id, token, activo, expira_at, ultimo_acceso, created_at, cliente:disabi_clientes(nombre, email)')
      .order('created_at', { ascending: false })

    return NextResponse.json({ ok: true, tokens: tokens ?? [] })
  } catch (e: unknown) {
    console.error('[api/portal-cliente GET]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// ── POST — gestión de tokens (requiere admin autenticado) ─────────────────────
export async function POST(req: NextRequest) {
  try {
    const sb   = await createClient()
    const body = await req.json()
    const { action } = body

    // Generar token con expiración de 30 días
    if (action === 'generar_token') {
      const { cliente_id, dias_validez = 30 } = body
      if (!cliente_id) return NextResponse.json({ error: 'cliente_id requerido' }, { status: 400 })

      // Validar días razonables (1 a 365)
      const dias = Math.min(365, Math.max(1, parseInt(dias_validez) || 30))
      const expira_at = new Date(Date.now() + dias * 86400000).toISOString()

      // Desactivar tokens anteriores
      await sb.from('disabi_portal_tokens')
        .update({ activo: false })
        .eq('cliente_id', cliente_id)

      // Crear nuevo token (Postgres genera el hex automáticamente)
      const { data, error } = await sb
        .from('disabi_portal_tokens')
        .insert([{ cliente_id, activo: true, expira_at }])
        .select('token, expira_at')
        .single()

      if (error) throw error
      return NextResponse.json({ ok: true, token: data.token, expira_at: data.expira_at })
    }

    // Revocar token manualmente
    if (action === 'revocar_token') {
      const { token_id } = body
      const { error } = await sb
        .from('disabi_portal_tokens')
        .update({ activo: false })
        .eq('id', token_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // Ver log de accesos de un cliente (para admins)
    if (action === 'get_accesos') {
      const { cliente_id, limit = 50 } = body
      const { data } = await sb
        .from('disabi_portal_accesos')
        .select('ip, user_agent, accessed_at')
        .eq('cliente_id', cliente_id)
        .order('accessed_at', { ascending: false })
        .limit(limit)
      return NextResponse.json({ ok: true, accesos: data ?? [] })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/portal-cliente POST]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
