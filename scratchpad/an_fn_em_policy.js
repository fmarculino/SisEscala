// Quais funcoes sao usadas DENTRO de policies de RLS ou de CHECK/DEFAULT de tabela?
//
// 🚨 POR QUE ISTO E O PASSO MAIS IMPORTANTE DO ITEM 13
//   A avaliacao de uma policy roda com os privilegios de QUEM CONSULTA. Se a policy chama
//   `get_my_role()` e o papel `authenticated` perde EXECUTE nessa funcao, TODA consulta daquele
//   papel passa a falhar — nao e degradacao, e a aplicacao inteira parando.
//   Isto e o oposto do risco de fechar de menos: aqui fechar demais e catastrofico e imediato.
const fs = require('fs')
const path = require('path')

const DIR = 'supabase/migrations'
const migrations = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()

// funcoes candidatas (as 37 da aplicacao sem chamador no codigo TS + as 17 de sessao)
const grupos = require('./anon_rpcs.json')
const candidatas = [
  ...grupos.sem_chamador.map(x => x.fn),
  ...grupos.sessao.map(x => x.fn),
  ...grupos.service_role.map(x => x.fn),
].filter(f => /^(fn_|get_|obter_)/.test(f))

const usoEmPolicy = new Map()   // fn -> Set(arquivo)
const usoEmCheck = new Map()

for (const arq of migrations) {
  const src = fs.readFileSync(path.join(DIR, arq), 'utf8')

  // blocos CREATE POLICY ... ; (pega USING e WITH CHECK)
  const policies = src.match(/CREATE\s+POLICY[\s\S]*?;/gi) || []
  for (const p of policies) {
    for (const fn of candidatas) {
      if (new RegExp(`\\b${fn}\\s*\\(`).test(p)) {
        if (!usoEmPolicy.has(fn)) usoEmPolicy.set(fn, new Set())
        usoEmPolicy.get(fn).add(arq)
      }
    }
  }

  // CHECK constraints e DEFAULTs de coluna
  const checks = src.match(/(?:CHECK\s*\([\s\S]{0,400}?\)|DEFAULT\s+[a-z_]+\s*\([^)]*\))/gi) || []
  for (const c of checks) {
    for (const fn of candidatas) {
      if (new RegExp(`\\b${fn}\\s*\\(`).test(c)) {
        if (!usoEmCheck.has(fn)) usoEmCheck.set(fn, new Set())
        usoEmCheck.get(fn).add(arq)
      }
    }
  }
}

// tambem: funcao chamada por OUTRA funcao (nesse caso SECURITY DEFINER protege, mas queremos saber)
const chamadaPorFuncao = new Map()
for (const arq of migrations) {
  const src = fs.readFileSync(path.join(DIR, arq), 'utf8')
  const corpos = src.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]*?\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$/gi) || []
  for (const c of corpos) {
    const dono = /FUNCTION\s+(?:public\.)?(\w+)/.exec(c)?.[1]
    for (const fn of candidatas) {
      if (fn === dono) continue
      if (new RegExp(`\\b${fn}\\s*\\(`).test(c)) {
        if (!chamadaPorFuncao.has(fn)) chamadaPorFuncao.set(fn, new Set())
        chamadaPorFuncao.get(fn).add(dono)
      }
    }
  }
}

console.log('='.repeat(78))
console.log('🚨 USADAS DENTRO DE POLICY DE RLS — NAO PODEM PERDER `authenticated`')
console.log('='.repeat(78))
const emPolicy = [...usoEmPolicy.keys()].sort()
for (const fn of emPolicy) {
  console.log(`  ${fn.padEnd(42)} (${usoEmPolicy.get(fn).size} migration(s))`)
}
if (!emPolicy.length) console.log('  (nenhuma)')

console.log('\n' + '='.repeat(78))
console.log('⚠️ USADAS EM CHECK / DEFAULT de tabela')
console.log('='.repeat(78))
const emCheck = [...usoEmCheck.keys()].sort().filter(f => !emPolicy.includes(f))
for (const fn of emCheck) console.log(`  ${fn.padEnd(42)} (${usoEmCheck.get(fn).size})`)
if (!emCheck.length) console.log('  (nenhuma)')

console.log('\n' + '='.repeat(78))
console.log('chamadas por OUTRA funcao SQL (SECURITY DEFINER protege — fechavel)')
console.log('='.repeat(78))
const soInterna = [...chamadaPorFuncao.keys()].sort()
  .filter(f => !emPolicy.includes(f) && !emCheck.includes(f))
for (const fn of soInterna) {
  const donos = [...chamadaPorFuncao.get(fn)].slice(0, 3).join(', ')
  console.log(`  ${fn.padEnd(42)} <- ${donos}`)
}

const semNada = candidatas.filter(f =>
  !emPolicy.includes(f) && !emCheck.includes(f) && !soInterna.includes(f)).sort()
console.log('\n' + '='.repeat(78))
console.log('sem uso em policy, check nem outra funcao — conferir individualmente')
console.log('='.repeat(78))
for (const fn of semNada) console.log(`  ${fn}`)

fs.writeFileSync('scratchpad/fn_classificacao.json', JSON.stringify({
  emPolicy, emCheck, soInterna, semNada,
  sessao: grupos.sessao.map(x => x.fn),
  publica: grupos.publica.map(x => x.fn),
}, null, 2))
console.log('\nsalvo em scratchpad/fn_classificacao.json')
