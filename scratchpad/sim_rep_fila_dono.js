// PORTAO do item 10: toda rota de /api/rep/v1/ que CONSOME fila precisa repassar o dispositivo
// que o HMAC autenticou.
//
// Roda:  node scratchpad/sim_rep_fila_dono.js
//
// POR QUE ELE EXISTE
//   A checagem de dono mora na RPC, mas o parametro tem `DEFAULT NULL` — e isso e' deliberado
//   (sem default, a ordem migration/deploy quebra nos dois sentidos e cadastros vao para
//   'falhou'; ver o cabecalho de 20260830130000). O preco desse default e' que a checagem so
//   vale se quem chama PASSAR o parametro.
//
//   Sem este portao, a proxima rota que consumir fila esquece de passar, a RPC recebe NULL, o
//   guard nao dispara, e ninguem ve — o mesmo formato de falha silenciosa que o item 10 era.
const fs = require('fs')
const path = require('path')

const RAIZ = 'src/app/api/rep/v1'
// RPCs que resolvem o dispositivo a partir de uma linha de FILA (e nao do chamador)
const RPCS_DE_FILA = [
  'fn_confirmar_cadastro_rep',
  'fn_confirmar_remocao_usuario_dispositivo',
]

function rotas(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...rotas(p))
    else if (e.name === 'route.ts') out.push(p.split(path.sep).join('/'))
  }
  return out
}

const falhas = []
let conferidas = 0

for (const arq of rotas(RAIZ)) {
  const src = fs.readFileSync(arq, 'utf8')

  for (const rpc of RPCS_DE_FILA) {
    if (!src.includes(`'${rpc}'`) && !src.includes(`"${rpc}"`)) continue
    conferidas++

    // 1. a rota autentica o dispositivo?
    if (!/autenticarDispositivoRep\s*\(/.test(src)) {
      falhas.push(`${arq}: chama ${rpc} sem autenticarDispositivoRep().`)
      continue
    }

    // 2. e repassa o dispositivo autenticado para a RPC?
    if (!/p_dispositivo_id\s*:\s*auth\.dispositivoId/.test(src)) {
      falhas.push(
        `${arq}: chama ${rpc} SEM passar \`p_dispositivo_id: auth.dispositivoId\`. ` +
        'A RPC recebe NULL, o guard de dono nao dispara, e a fila de outro relogio pode ser ' +
        'confirmada por este.')
    }
  }
}

// 3. o guard tem que existir de fato na migration mais recente que define cada RPC
const DIR_MIG = 'supabase/migrations'
for (const rpc of RPCS_DE_FILA) {
  const arqs = fs.readdirSync(DIR_MIG).filter(f => f.endsWith('.sql')).sort()
    .filter(f => fs.readFileSync(path.join(DIR_MIG, f), 'utf8').includes(`FUNCTION public.${rpc}`))
  if (!arqs.length) { falhas.push(`nenhuma migration define ${rpc}`); continue }
  const vig = fs.readFileSync(path.join(DIR_MIG, arqs[arqs.length - 1]), 'utf8')
  if (!vig.includes('p_dispositivo_id uuid DEFAULT NULL')) {
    falhas.push(`${arqs[arqs.length - 1]}: ${rpc} vigente NAO tem o parametro p_dispositivo_id.`)
  }
  if (!/IS DISTINCT FROM p_dispositivo_id/.test(vig)) {
    falhas.push(`${arqs[arqs.length - 1]}: ${rpc} vigente NAO tem o guard de dono.`)
  }
}

console.log(`Rotas de ${RAIZ} que consomem fila: ${conferidas} chamada(s) conferida(s)`)
console.log(`RPCs de fila verificadas na migration vigente: ${RPCS_DE_FILA.length}\n`)

if (falhas.length) {
  console.error('REPROVADO:')
  for (const f of falhas) console.error('  - ' + f)
  process.exit(1)
}
console.log('APROVADO: toda rota de fila repassa o dispositivo autenticado, e o guard existe na RPC.')
