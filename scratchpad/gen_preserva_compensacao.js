/**
 * Acrescenta a preservacao da DECISAO DE COMPENSACAO nas QUATRO copias da geracao de folha.
 *
 * As quatro sao executeGerarFolhaPonto, sincronizarFolhaPonto (folha-ponto/actions.ts),
 * gerarFolhaPontoServidor e sincronizarFolhaPontoServidor (consultar-escala/actions.ts) — ver
 * "A folha e um snapshot" no CLAUDE.md. Sem isto, "Sincronizar" apaga a autorizacao que o
 * coordenador acabou de dar (o snapshot e reconstruido do zero).
 *
 * ABORTA se qualquer contagem divergir.
 */
const fs = require('fs')
const path = require('path')
const RAIZ = path.join(__dirname, '..')
const ARQ_FOLHA = path.join(RAIZ, 'src/app/(dashboard)/folha-ponto/actions.ts')
const ARQ_PORTAL = path.join(RAIZ, 'src/app/consultar-escala/actions.ts')
const conta = (t, p) => t.split(p).length - 1

const APLICA = (nomePush) => `
      // A decisao de compensacao de atraso e DECISAO HUMANA (Portaria 382/2019, Art. 7 §1/§2):
      // sobrevive a regeracao, como manda a regra de preservacao.ts. O valor em minutos e
      // recalculado sobre os horarios atuais; o que se preserva e a autorizacao.
      carregarDecisaoCompensacao(registro, registroExistente)

      ${nomePush}.push(registro)`

function editar(arquivo, pares) {
  let s = fs.readFileSync(arquivo, 'utf8')
  const crlf = s.includes('\r\n')
  const n2 = t => (crlf ? t.replace(/\n/g, '\r\n') : t)
  for (const [alvo, novo, esperado, rotulo] of pares) {
    const a = n2(alvo)
    const n = conta(s, a)
    if (n !== esperado) throw new Error(`${path.basename(arquivo)} / ${rotulo}: esperava ${esperado}, achou ${n}`)
    s = s.split(a).join(n2(novo))
  }
  fs.writeFileSync(arquivo, s)
}

editar(ARQ_FOLHA, [
  ['\n      registros.push(registro)', APLICA('registros'), 1, 'aplica (executeGerarFolhaPonto)'],
  ['\n      registrosAtualizados.push(registro)', APLICA('registrosAtualizados'), 1, 'aplica (sincronizarFolhaPonto)'],
])

editar(ARQ_PORTAL, [
  ['\n      registrosAtualizados.push(registro)', APLICA('registrosAtualizados'), 1, 'aplica (sincronizarFolhaPontoServidor)'],
  ['\n      registros.push(registro)', APLICA('registros'), 1, 'aplica (gerarFolhaPontoServidor)'],
  [
    "import { autorizacaoDoDia, aplicarObservacaoAutorizacao } from '@/utils/folha/autorizacaoPonto'",
    "import { autorizacaoDoDia, aplicarObservacaoAutorizacao } from '@/utils/folha/autorizacaoPonto'\nimport { carregarDecisaoCompensacao } from '@/utils/folha/calculoDia'",
    1, 'import (portal)',
  ],
])

for (const arq of [ARQ_FOLHA, ARQ_PORTAL]) {
  const s = fs.readFileSync(arq, 'utf8')
  const n = conta(s, 'carregarDecisaoCompensacao(registro, registroExistente)')
  if (n !== 2) throw new Error(`${path.basename(arq)}: esperava 2 aplicacoes, achou ${n}`)
  console.log(`${path.basename(arq)}: 2 aplicacoes OK`)
}
