// Confere 20260911130000 em PRODUCAO, EXECUTANDO as funcoes (armadilha 42: conferir que a
// funcao existe nao prova nada — a que quebrou em producao existia).
//
// 🚨 SO LEITURA. fn_mesclar_servidores NAO e chamada aqui, nem no caminho que deveria recusar:
// se a recusa falhasse, ela MESCLARIA dois cadastros de servidor publico em producao, sem
// desfazer. Esse caminho foi provado em homologacao, com cenario sintetico revertido (9 de 9).
//
//   node scratchpad/ver_mesclagem_declarada_producao.mjs
import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

let falhas = []
const ok = (r, cond, det) => { if (!cond) falhas.push(`${r}${det ? ' -- ' + det : ''}`); else console.log(`  ok  ${r}`) }

// ⚠️ PAGINADO. O PostgREST corta em 1000 em SILENCIO (armadilha 8), e sao 2,6 mil servidores
// ativos: sem isto a varredura de pares nao acha o par que motivou a mudanca e "passa" dizendo
// que ele nao existe. Aconteceu na primeira versao deste script.
async function q(p) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`)
    const pag = await r.json()
    out.push(...pag)
    if (pag.length < 1000) break
  }
  return out
}
async function rpc(fn, body, chave = K) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, corpo: await r.text() }
}

// O par real: dois cadastros Ativos, mesmo nome normalizado, CPF divergente.
const S = await q('servidores?select=id,nome,matricula,cpf,status,unidade_id&status=eq.Ativo&mesclado_em_servidor_id=is.null')
const norm = n => (n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const d = v => (v || '').replace(/\D/g, '')
const porNome = {}
for (const s of S) (porNome[norm(s.nome)] = porNome[norm(s.nome)] || []).push(s)
const pares = Object.values(porNome)
  .filter(l => l.length === 2 && new Set(l.map(s => d(s.cpf))).size === 2 && l.every(s => d(s.cpf).length === 11))

console.log(`producao: ${S.length} servidores ativos; ${pares.length} par(es) com nome identico e CPF divergente`)
ok('existe o par que motivou a mudanca', pares.length >= 1, `achei ${pares.length}`)

if (pares.length) {
  const [a, b] = pares[0]
  console.log(`  par: ${a.matricula} (${d(a.cpf)}) x ${b.matricula} (${d(b.cpf)})`)

  // 1) a identidade divergente e devolvida por inteiro
  const div = await rpc('fn_divergencias_identidade_servidor', { p_origem: b.id, p_destino: a.id })
  ok('fn_divergencias_identidade_servidor responde 200', div.status === 200, div.corpo.slice(0, 200))
  const campos = JSON.parse(div.corpo).map(x => x.campo)
  ok('o CPF esta entre as divergencias', campos.includes('cpf'), JSON.stringify(campos))
  ok('nao e SO o CPF que diverge neste par', campos.length > 1, JSON.stringify(campos))
  console.log(`  divergem: ${campos.join(', ')}`)

  // 2) SEM declaracao, o par continua impedido — o sentido que PROTEGE
  const sem = await rpc('fn_impedimentos_mesclagem_servidor', { p_origem: b.id, p_destino: a.id })
  ok('chamada de 2 argumentos ainda funciona (sem PGRST203)', sem.status === 200, sem.corpo.slice(0, 200))
  const motivosSem = JSON.parse(sem.corpo).map(x => x.motivo)
  ok('sem declaracao, cpf_divergente continua', motivosSem.includes('cpf_divergente'), JSON.stringify(motivosSem))

  const semExplicito = await rpc('fn_impedimentos_mesclagem_servidor',
    { p_origem: b.id, p_destino: a.id, p_confirmar_identidade: false })
  ok('com false explicito, cpf_divergente continua',
     JSON.parse(semExplicito.corpo).map(x => x.motivo).includes('cpf_divergente'), semExplicito.corpo.slice(0, 200))

  // 3) COM declaracao, o cpf_divergente sai — e nenhum outro impedimento aparece neste par
  const com = await rpc('fn_impedimentos_mesclagem_servidor',
    { p_origem: b.id, p_destino: a.id, p_confirmar_identidade: true })
  ok('fn_impedimentos com declaracao responde 200', com.status === 200, com.corpo.slice(0, 200))
  const motivosCom = JSON.parse(com.corpo).map(x => x.motivo)
  ok('com declaracao, cpf_divergente sai', !motivosCom.includes('cpf_divergente'), JSON.stringify(motivosCom))
  console.log(`  impedimentos restantes com declaracao: ${motivosCom.length ? motivosCom.join(', ') : '(nenhum)'}`)
}

// 4) anon nao alcanca nenhuma das novas.
//    ⚠️ Com os ARGUMENTOS CERTOS: corpo vazio da 404 PGRST202 ("assinatura nao encontrada") em
//    qualquer caso, e isso nao prova privilegio nenhum — foi o erro da primeira versao deste
//    script. Com os argumentos certos, 404 significa que a funcao nem aparece no schema cache do
//    role anon, que e' exatamente o efeito do REVOKE.
const NULO1 = '00000000-0000-0000-0000-000000000001'
const NULO2 = '00000000-0000-0000-0000-000000000002'
const chamadasAnon = [
  ['fn_divergencias_identidade_servidor', { p_origem: NULO1, p_destino: NULO2 }],
  ['fn_impedimentos_mesclagem_servidor', { p_origem: NULO1, p_destino: NULO2 }],
  ['fn_mesclar_servidores', { p_origem: NULO1, p_destino: NULO2, p_motivo: null }],
]
for (const [fn, args] of chamadasAnon) {
  const r = await rpc(fn, args, ANON)
  ok(`anon nao alcanca ${fn} (${r.status})`,
     [401, 403, 404].includes(r.status), r.corpo.slice(0, 140))
  // e o mesmo corpo com service_role TEM que passar do PostgREST — senao o 404 acima seria
  // assinatura errada minha, nao privilegio.
  const s = await rpc(fn, args)
  ok(`  ...e a mesma chamada com service_role resolve a assinatura`,
     !s.corpo.includes('PGRST202'), s.corpo.slice(0, 140))
}

// 5) a assinatura antiga nao sobrou: chamada de 3 argumentos nao pode dar PGRST203.
//    uuid inexistente -> a funcao levanta "cadastro nao encontrado", o que ja prova que resolveu
//    UMA assinatura so. PGRST203 seria ambiguidade.
const tresArgs = await rpc('fn_mesclar_servidores', {
  p_origem: '00000000-0000-0000-0000-000000000001',
  p_destino: '00000000-0000-0000-0000-000000000002',
  p_motivo: null,
})
ok('chamada de 3 argumentos nao e ambigua (sem PGRST203)',
   !tresArgs.corpo.includes('PGRST203'), tresArgs.corpo.slice(0, 200))
ok('e ela para em "cadastro nao encontrado", sem mexer em nada',
   tresArgs.corpo.includes('nao encontrado'), tresArgs.corpo.slice(0, 200))

console.log(falhas.length ? `\nFALHAS (${falhas.length}):` : '\nTUDO CERTO.')
falhas.forEach(f => console.log('  - ' + f))
process.exit(falhas.length ? 1 : 0)
