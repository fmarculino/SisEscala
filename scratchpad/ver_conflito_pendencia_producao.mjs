/**
 * Confere em PRODUCAO a 20260916100000 — EXECUTANDO as funcoes (armadilha 42), nunca so
 * perguntando se existem. SOMENTE LEITURA: fn_conflito_pendencia_rh e STABLE, e
 * fn_promover_pendencia_rh so e chamada com id inexistente (nao ha o que gravar).
 *
 * O comportamento COMPLETO (9 cenarios) foi validado em homologacao, com md5(prosrc) identico ao
 * do arquivo. Por fora, em producao, o que da para provar sem sessao de usuario e:
 *   - a funcao nova existe e o guard dela RECUSA papel nulo (era o 4o defeito);
 *   - anon nao executa;
 *   - nao ha sobrecarga ambigua.
 * A prova do resto e a propria migration ter aplicado: a conferencia embutida ABORTA se
 * fn_promover_pendencia_rh nao checar v_cpf_final, e ela roda o caminho completo com JWT
 * sintetico de super_admin sobre as pendencias reais.
 *
 * Sai com codigo 1 se qualquer assercao falhar.
 */
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const SR = env.SUPABASE_SERVICE_ROLE_KEY
const AN = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const h = k => ({ apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' })

let ok = 0; const falhas = []
const certo = (c, d) => c ? ok++ : falhas.push(d)

async function rpc(nome, body, chave = SR) {
  const r = await fetch(`${U}/rest/v1/rpc/${nome}`, { method: 'POST', headers: h(chave), body: JSON.stringify(body) })
  return { status: r.status, corpo: await r.text() }
}
const get = async p => (await fetch(`${U}/rest/v1/${p}`, { headers: h(SR) })).json()

const [alvo] = await get('importacao_rh_pendentes?matricula=eq.53599&promovido_em=is.null&select=id,nome,cpf_normalizado,unidade_id')
  .then(r => r.length ? r : get('importacao_rh_pendentes?promovido_em=is.null&unidade_id=is.null&limit=1&select=id,nome,cpf_normalizado,unidade_id'))
if (!alvo) { console.log('sem pendencia aberta para conferir'); process.exit(1) }

// 1) A funcao EXISTE (nao e 404/PGRST202) — a migration esta aplicada
const chamada = await rpc('fn_conflito_pendencia_rh', { p_pendencia_id: alvo.id })
certo(!chamada.corpo.includes('PGRST202'), 'fn_conflito_pendencia_rh nao existe em producao')

// 2) O GUARD NOVO esta ativo: service_role nao tem papel (get_my_role() = NULL) e e RECUSADO.
//    Era exatamente isto que o `NOT IN` puro deixava passar — e foi o que abortou a 1a tentativa.
certo(chamada.status === 403 && chamada.corpo.includes('42501'),
  `papel nulo deveria ser recusado com 42501, veio ${chamada.status}: ${chamada.corpo.slice(0,120)}`)

// 3) anon tambem nao executa (armadilha 24: quem restringe e o REVOKE)
const anon = await rpc('fn_conflito_pendencia_rh', { p_pendencia_id: alvo.id }, AN)
certo(anon.status === 401 || anon.status === 403, `anon deveria ser recusado, veio ${anon.status}`)

// 4) sem sobrecarga ambigua na promocao (armadilha 41)
const amb = await rpc('fn_promover_pendencia_rh',
  { p_pendencia_id: '00000000-0000-0000-0000-000000000000', p_unidade_id: null,
    p_setor_id: null, p_cargo: 'X', p_confirma_vinculo_adicional: false, p_cpf: null })
certo(!amb.corpo.includes('PGRST203'), 'ha sobrecarga ambigua de fn_promover_pendencia_rh')
certo(!amb.corpo.includes('PGRST202'), 'fn_promover_pendencia_rh de 6 parametros nao existe')

const r = await fetch(`${U}/rest/v1/importacao_rh_pendentes?promovido_em=is.null&unidade_id=is.null&select=id`,
  { headers: { ...h(SR), Prefer: 'count=exact', Range: '0-0' } })
console.log(`\n  pendencia conferida: ${alvo.nome} (unidade_id=${alvo.unidade_id})`)
console.log(`  pendencias sem unidade resolvida, que a tela agora consegue conferir: ${(r.headers.get('content-range')||'').split('/')[1]}`)

console.log(`\n${ok} asserções OK, ${falhas.length} falhas`)
if (falhas.length) { falhas.forEach(f => console.log(`  REPROVADO: ${f}`)); process.exit(1) }
console.log('PRODUCAO OK')
