// Remove a reconciliacao DUPLICADA do lado do servidor (19/09/2026).
// Detecta o EOL de cada arquivo em vez de assumir e ABORTA se qualquer substituicao nao bater.
import fs from 'fs'
const eol = s => s.includes('\r\n') ? '\r\n' : '\n'
function trocar(arq, pares) {
  let s = fs.readFileSync(arq, 'utf8')
  const N = eol(s)
  for (const [de, para] of pares) {
    const d = de.replace(/\n/g, N), p = para.replace(/\n/g, N)
    const n = s.split(d).length - 1
    if (n !== 1) throw new Error(`${arq}: esperava 1 ocorrencia, achei ${n} -> ${d.slice(0, 70)}`)
    s = s.replace(d, p)
  }
  fs.writeFileSync(arq, s)
  console.log(`  ${arq} (${N === '\r\n' ? 'CRLF' : 'LF'}): ${pares.length} substituicao(oes)`)
}

const PORQUE = (ind) => [
  `// NADA de reconciliar aqui. \`fn_ingerir_afd\` ja reconcilia, na MESMA transacao (passo 3.6,`,
  `// desde 20260818080000) e com \`fn_reconciliar_pessoa_dia\`, que e a versao completa - este`,
  `// laco refazia o mesmo conjunto de pares (servidor, dia) por HTTP, um RPC de cada vez.`,
  `//`,
  `// 🚨 Nao era so desperdicio: era METADE do tempo de resposta, e foi o que travou o`,
  `// REP-iDClass-HMI-01 em 18/09/2026. Um lote de 500 linhas gera ~390 pares; a funcao leva ~30s`,
  `// e este laco levava outro tanto. Passando dos 60s de timeout do coletor o cliente aborta, a`,
  `// conexao cai, o Postgres REVERTE a transacao inteira - inclusive a propria linha de`,
  `// \`rep_sincronizacoes\` - e o coletor remonta o MESMO lote no ciclo seguinte, para sempre.`,
  `// 509 batidas de um hospital sumiram por 38h, sem rastro em tela nenhuma.`,
  `//`,
  `// ⚠️ No caminho de reenvio (\`reenvio: true\`) era pior: o lote ja tinha sido ingerido e`,
  `// reconciliado, e reconciliava-se tudo de novo a cada ciclo, de graca.`,
].map(l => ind + l).join('\n')

trocar('src/app/api/rep/v1/marcacoes/route.ts', [
  [`import { reconciliarSincronizacaoAfd } from '@/utils/reconciliacaoHelper'\n`, ``],
  [`  // Reconciliação em tempo real de escala_diaria para os servidores que bateram ponto no lote\n` +
   `  if (data?.sincronizacao_id && (data?.marcacoes || 0) > 0) {\n` +
   `    await reconciliarSincronizacaoAfd(data.sincronizacao_id)\n` +
   `  }\n`,
   PORQUE('  ') + `\n`],
])

trocar('src/app/(dashboard)/marcacoes/actions.ts', [
  [`import { reconciliarSincronizacaoAfd } from '@/utils/reconciliacaoHelper'\n`, ``],
  [`    if (data?.sincronizacao_id && (data?.marcacoes || 0) > 0) {\n` +
   `      await reconciliarSincronizacaoAfd(data.sincronizacao_id)\n` +
   `    }\n`,
   PORQUE('    ') + `\n`],
])

fs.unlinkSync('src/utils/reconciliacaoHelper.ts')
console.log('  src/utils/reconciliacaoHelper.ts removido')

const sobrou = []
;(function varrer(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${f.name}`
    if (f.isDirectory()) varrer(p)
    else if (/\.(ts|tsx)$/.test(f.name) && fs.readFileSync(p, 'utf8').includes('reconciliacaoHelper')) sobrou.push(p)
  }
})('src')
if (sobrou.length) throw new Error('ainda referenciam o helper: ' + sobrou.join(', '))
console.log('OK: nenhuma referencia restante ao helper')
