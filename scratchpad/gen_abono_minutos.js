/**
 * Grava `abono_minutos` no registro, nas QUATRO copias da geracao de folha.
 *
 * O campo "Abono" do rodape (pedido do RH em 04/09/2026) e TEMPO ABONADO, nao dia de
 * afastamento: contar dia com afastamento daria 1.173 "abonos" em 08/2026 — Ferias, Licenca
 * Premio, Licenca saude. Ver minutosAbonadosDoDia em src/utils/folha/afastamentosDia.ts.
 *
 * ABORTA se qualquer contagem divergir.
 */
const fs = require('fs')
const path = require('path')
const RAIZ = path.join(__dirname, '..')
const ARQ_FOLHA = path.join(RAIZ, 'src/app/(dashboard)/folha-ponto/actions.ts')
const ARQ_PORTAL = path.join(RAIZ, 'src/app/consultar-escala/actions.ts')
const conta = (t, p) => t.split(p).length - 1

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

// O campo entra ao lado de `afastamento`, que ja e derivado dos mesmos eventos do dia.
const COM_VIRGULA = `        afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null,`
const SEM_VIRGULA = `        afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null`
// ⚠️ afastamentosDia (TODOS do dia), nao afastamentosAnulantes: o abono vem justamente da
// declaracao por horas, que NAO anula o turno (o servidor trabalha o resto do dia).
const NOVO_LINHA = `        abono_minutos: minutosAbonadosDoDia(afastamentosDia),`

editar(ARQ_FOLHA, [
  [COM_VIRGULA, `${COM_VIRGULA}\n${NOVO_LINHA}`, 2, 'campo abono_minutos (2 copias)'],
  [
    `import { afastamentosDoDia, descreverAfastamentos, isShiftOverlappingAfastamento } from '@/utils/folha/afastamentosDia'`,
    `import { afastamentosDoDia, descreverAfastamentos, isShiftOverlappingAfastamento, minutosAbonadosDoDia } from '@/utils/folha/afastamentosDia'`,
    1, 'import (folha-ponto)',
  ],
])

editar(ARQ_PORTAL, [
  [SEM_VIRGULA, `${COM_VIRGULA}\n${NOVO_LINHA.replace(/,$/, '')}`, 2, 'campo abono_minutos (2 copias)'],
])

// O import do portal: descobre a linha real e acrescenta o simbolo.
let sp = fs.readFileSync(ARQ_PORTAL, 'utf8')
const impPortal = sp.split(/\r?\n/).find(l => l.includes('afastamentosDia') && l.startsWith('import'))
if (!impPortal) throw new Error('import de afastamentosDia nao achado no portal')
if (!impPortal.includes('minutosAbonadosDoDia')) {
  const novoImp = impPortal.replace('descreverAfastamentos', 'descreverAfastamentos, minutosAbonadosDoDia')
  if (conta(sp, impPortal) !== 1) throw new Error('import do portal nao e unico')
  sp = sp.replace(impPortal, novoImp)
  fs.writeFileSync(ARQ_PORTAL, sp)
}

for (const arq of [ARQ_FOLHA, ARQ_PORTAL]) {
  const s = fs.readFileSync(arq, 'utf8')
  const n = conta(s, 'abono_minutos: minutosAbonadosDoDia(afastamentosDia)')
  if (n !== 2) throw new Error(`${path.basename(arq)}: esperava 2, achou ${n}`)
  if (conta(s, 'minutosAbonadosDoDia') !== 3) throw new Error(`${path.basename(arq)}: import ausente`)
  console.log(`${path.basename(arq)}: 2 gravacoes + import OK`)
}
