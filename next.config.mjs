/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false,

  // Límite para importación masiva ZIP (200 MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '200mb',
    },
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Clickjacking
          { key: 'X-Frame-Options',              value: 'DENY' },
          // MIME sniffing
          { key: 'X-Content-Type-Options',       value: 'nosniff' },
          // Referrer
          { key: 'Referrer-Policy',              value: 'strict-origin-when-cross-origin' },
          // Permissions
          { key: 'Permissions-Policy',           value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS — fuerza HTTPS por 2 años
          { key: 'Strict-Transport-Security',    value: 'max-age=63072000; includeSubDomains; preload' },
          // XSS Protection (legacy browsers)
          { key: 'X-XSS-Protection',             value: '1; mode=block' },
          // DNS Prefetch
          { key: 'X-DNS-Prefetch-Control',       value: 'on' },
          // Content Security Policy
          // Permite: scripts/estilos del mismo origen + cdnjs para recharts,
          // imágenes del mismo origen + api.qrserver.com (QR codes del 2FA)
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval requerido por Next.js dev
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://api.qrserver.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      // Portal público — CSP ligeramente más permisivo para clientes externos
      {
        source: '/portal(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://api.qrserver.com",
              "connect-src 'self' https://*.supabase.co",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
