import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { sugerirNomesParecidos, encontrarNomeIdentico, normalizarNomeSetor } = require('./_sim/nomeSetor.js')
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const dic = (await (await fetch(`${U}/rest/v1/dicionario_setores?select=nome&order=nome`, { headers: H })).json()).map(d => d.nome)
console.log('entradas no dicionario:', dic.length)

// 1) RUIDO: digitando um nome que JA existe, quantos "parecidos" apareceriam junto?
let comAlerta = 0, totalSug = 0
const exemplos = []
for (const nome of dic) {
  const outros = dic.filter(n => n !== nome)
  const s = sugerirNomesParecidos(nome, outros)
  if (s.length) { comAlerta++; totalSug += s.length; exemplos.push({ digitado: nome, sugeridos: s.map(x=>`${x.nome} [${x.motivo}]`).join(' | ') }) }
}
console.log(`\nnomes que disparariam alerta: ${comAlerta}/${dic.length} (${(comAlerta/dic.length*100).toFixed(1)}%) | media de ${(totalSug/(comAlerta||1)).toFixed(1)} sugestoes`)
console.log('\n=== TODOS os alertas que o dicionario atual produziria ===')
console.table(exemplos.map(e => ({ digitado: e.digitado.slice(0,38), sugeridos: e.sugeridos.slice(0,70) })))

// 2) o caso que motivou: os nomes ja padronizados seriam pegos?
console.log('\n=== o caso real (nomes ja removidos do dicionario) ===')
for (const teste of ['SERVIÇOS GERAIS', 'SERVICOS GERAIS', 'ASG', 'SERVIÇOS GERAIS ']) {
  const id = encontrarNomeIdentico(teste, dic)
  const s = sugerirNomesParecidos(teste, dic)
  console.log(` "${teste}" -> identico: ${id || '(nenhum)'} | parecidos: ${s.map(x=>`${x.nome} [${x.motivo}]`).join(', ') || '(nenhum)'}`)
}
