// PONTO DE ENTRADA ÚNICO da conferência de segurança (auditoria de 30/08/2026).
//
//   node scratchpad/conferir_seguranca.mjs           -> só os portões locais (offline, rápido)
//   node scratchpad/conferir_seguranca.mjs --producao -> + sondas contra PRODUÇÃO (só leitura)
//
// Existe para não ser preciso lembrar de 6 scripts. Sai com código 1 se qualquer um reprovar.
//
// ⚠️ AO REAUDITAR COM FERRAMENTA EXTERNA, leia antes a seção "O que esperar ao rodar o script de
// novo" em docs/security-audit/PLANO-DE-CORRECAO.md. Resultado PIOR que o original é, quase
// sempre, detector desatualizado — não código quebrado. Medido: a varredura de Server Actions
// saltou de 15 para 29 achados depois da correção do Portal, e nenhum era real; ela procurava a
// string `portal_servidor_id`, que a correção eliminou.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const COM_PRODUCAO = process.argv.includes('--producao')

const PORTOES = [
  ['sim_portal_sessao.js',    'Portal: nenhuma ação aceita servidorId do cliente'],
  ['sim_portal_cookie.mjs',   'Portal: 12 casos de forja do cookie de sessão'],
  ['sim_bloqueio_pin.mjs',    'PIN: bloqueio no banco idêntico ao antigo (352 estados)'],
  ['sim_html_seguro.mjs',     'XSS: primitiva de escape (21 casos)'],
  ['sim_relatorio_render.mjs','XSS: relatório renderizado com payload de ataque'],
  ['sim_rep_fila_dono.js',    'REP: rotas de fila repassam o dispositivo autenticado'],
]

const SONDAS = [
  ['an_verify_pin_anon.mjs',    'verify_pin fechada para anon; conta RPCs visíveis'],
  ['an_confere_fila_dono.mjs',  'fila do REP: assinatura, grants e compatibilidade'],
]

let falhas = 0

function rodar(arquivo, descricao) {
  const caminho = `scratchpad/${arquivo}`
  if (!fs.existsSync(caminho)) {
    console.log(`  AUSENTE  ${arquivo.padEnd(28)} ${descricao}`)
    falhas++
    return
  }
  try {
    execSync(`node ${caminho}`, { stdio: 'pipe' })
    console.log(`  ok       ${arquivo.padEnd(28)} ${descricao}`)
  } catch (e) {
    falhas++
    console.log(`  REPROVOU ${arquivo.padEnd(28)} ${descricao}`)
    const saida = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    for (const l of saida.split('\n').filter(l => /REPROVAD|FALHA|ABORTAD|- /.test(l)).slice(0, 6)) {
      console.log(`             ${l.trim()}`)
    }
  }
}

console.log('\nPORTÕES LOCAIS (offline)\n' + '='.repeat(78))
for (const [a, d] of PORTOES) rodar(a, d)

if (COM_PRODUCAO) {
  console.log('\nSONDAS CONTRA PRODUÇÃO (somente leitura)\n' + '='.repeat(78))
  if (!fs.existsSync('.env.production')) {
    console.log('  .env.production ausente — sondas puladas.')
  } else {
    for (const [a, d] of SONDAS) rodar(a, d)
  }
} else {
  console.log('\n(sondas de produção puladas — use --producao para incluí-las)')
}

console.log('\n' + '='.repeat(78))
if (falhas) {
  console.error(`${falhas} verificação(ões) REPROVARAM.`)
  process.exit(1)
}
console.log('Todas as verificações passaram.')
console.log('\nPendente da auditoria: item 11 (cert_fingerprint do coletor) — exige acesso ao')
console.log('hardware da unidade. Ver docs/security-audit/PLANO-DE-CORRECAO.md.')
