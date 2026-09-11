import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const cnt = async (p) => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...H, Prefer:'count=exact', Range:'0-0' } }); return parseInt((r.headers.get('content-range')||'/0').split('/')[1]) }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if(!r.ok){console.error(p,r.status,(await r.text()).slice(0,200));return []} return r.json() }

console.log('=== ALCANCE DE "ESQUECI MEU PIN" POR E-MAIL ===')
const ativos = await cnt('servidores?select=id&status=eq.Ativo')
const comEmail = await cnt('servidores?select=id&status=eq.Ativo&email=not.is.null')
console.log('  servidores Ativos:', ativos)
console.log('  com e-mail preenchido:', comEmail, `(${(comEmail/ativos*100).toFixed(1)}%)`)

// e-mail compartilhado por mais de uma pessoa = nao serve como prova de posse
const todos = await q('servidores?select=id,email,status&status=eq.Ativo&email=not.is.null&limit=2000')
const porEmail = {}
for (const s of todos) { const e = (s.email||'').trim().toLowerCase(); if(e) (porEmail[e] ||= []).push(s.id) }
const compart = Object.entries(porEmail).filter(([,v])=>v.length>1)
console.log('  e-mails COMPARTILHADOS por 2+ servidores ativos:', compart.length, '| pessoas envolvidas:', compart.reduce((a,[,v])=>a+v.length,0))
console.log('  piores:', compart.sort((a,b)=>b[1].length-a[1].length).slice(0,5).map(([e,v])=>`${e.slice(0,22)}=${v.length}`).join(' | '))

const semEmailComPin = await cnt('servidores?select=id&status=eq.Ativo&email=is.null&pin_acesso=not.is.null')
console.log('  Ativos SEM e-mail (continuariam dependendo do coordenador):', semEmailComPin)

console.log('\n=== bloqueios de PIN hoje (a dor real) ===')
console.log('  com tentativas falhas > 0:', await cnt('servidores?select=id&pin_failed_attempts=gt.0'))
console.log('  bloqueados agora:', await cnt(`servidores?select=id&pin_locked_until=gte.${new Date().toISOString()}`))
