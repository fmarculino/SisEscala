const fs = require('fs')

function env(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.includes('='))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
  )
}

// Somente LEITURA. Nenhuma chamada POST/PATCH/DELETE nesta lib.
function conn(which) {
  const e = env('c:/Users/Cliente/Projetos/SisEscala/' + (which === 'prod' ? '.env.production' : '.env.local'))
  const U = e.NEXT_PUBLIC_SUPABASE_URL
  const K = e.SUPABASE_SERVICE_ROLE_KEY
  const H = { apikey: K, Authorization: 'Bearer ' + K }
  return {
    // paginacao obrigatoria: PostgREST corta em 1000 linhas silenciosamente (armadilha 8)
    async all(path) {
      const out = []
      for (let from = 0; ; from += 1000) {
        const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
        if (!r.ok) throw new Error(r.status + ' ' + (await r.text()))
        const page = await r.json()
        out.push(...page)
        if (page.length < 1000) break
      }
      return out
    }
  }
}

module.exports = { conn }
