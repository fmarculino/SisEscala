// Item 13: das funcoes ainda abertas a `anon`, quais REALMENTE devolvem dado sem login?
//
// ⚠️ SO FUNCOES DE LEITURA sao sondadas. As de escrita (fn_gerar_token_dispositivo_rep,
// fn_promover_pendencia_rh, fn_salvar_justificativas_bulk, fn_enfileirar_*, fn_higiene_*,
// fn_atualizar_cadastro_via_pendencia_rh) ficam FORA desta sonda de proposito: descobrir que
// elas escrevem, escrevendo, e' pagar caro por uma informacao que a leitura do corpo ja da.
//
// A hipotese a testar e a da migration 20260827050000: "funcao que confere papel sozinha nao
// precisa de REVOKE, porque com anon get_my_role() e NULL e ela recusa". Isto mede se e verdade.
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }

const HOJE = new Date().toISOString().slice(0, 10)

// [nome, argumentos]  — todas de LEITURA
const SONDAS = [
  ['get_my_role', {}],
  ['fn_setores_no_escopo', {}],
  ['fn_unidade_no_escopo', { p_unidade_id: null }],
  ['fn_trilha_auditoria', {}],
  ['fn_painel_sobreaviso_dia', { p_data: HOJE }],
  ['fn_pendencias_biometria', {}],
  ['fn_vinculos_sugeridos_afd', {}],
  ['fn_tentativas_negadas_resumo', {}],
  ['fn_listar_eventos_pendentes_justificativa', {}],
  ['fn_buscar_pendencia_rh_por_termo', { p_termo: 'a' }],
  ['fn_terminal_classico_habilitado', {}],
  ['fn_precedencia_origem', { p_origem: 'rep' }],
  ['fn_cpf_digito_valido', { p_cpf: '11144477735' }],
  ['fn_jornada_tem_intervalo', { p_duracao_minutos: 480, p_intervalo_minutos: 60 }],
  ['fn_intervalo_minimo_legal', { p_duracao_minutos: 480 }],
]

const linhas = []
for (const [fn, args] of SONDAS) {
  let status = '?', amostra = ''
  try {
    const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
    status = r.status
    const t = await r.text()
    if (r.status === 200) {
      let j
      try { j = JSON.parse(t) } catch { j = t }
      if (Array.isArray(j)) amostra = `array[${j.length}]` + (j.length ? ` ex.: ${JSON.stringify(j[0]).slice(0, 70)}` : '')
      else amostra = JSON.stringify(j).slice(0, 80)
    } else {
      amostra = t.slice(0, 70)
    }
  } catch (e) { status = 'ERRO'; amostra = String(e).slice(0, 60) }
  linhas.push({ fn, status, amostra })
}

console.log('Sonda com a chave ANON (a que vai no bundle do navegador)\n')
console.log('  ' + 'funcao'.padEnd(44) + 'HTTP  resultado')
console.log('  ' + '-'.repeat(100))
for (const l of linhas) {
  console.log(`  ${l.fn.padEnd(44)}${String(l.status).padEnd(6)}${l.amostra}`)
}

const vazam = linhas.filter(l => l.status === 200 && /array\[[1-9]/.test(l.amostra))
console.log('\n' + '='.repeat(100))
if (vazam.length) {
  console.log(`🚨 ${vazam.length} funcao(oes) DEVOLVERAM DADO sem login:`)
  for (const l of vazam) console.log(`   ${l.fn}  ->  ${l.amostra}`)
} else {
  console.log('Nenhuma das sondadas devolveu LINHA de dado sem login.')
  console.log('As que respondem 200 com vazio/valor puro sao funcao de calculo ou recusam por papel')
  console.log('(get_my_role() e NULL para anon) — o que CONFIRMA a hipotese da 20260827050000.')
}
console.log('='.repeat(100))
