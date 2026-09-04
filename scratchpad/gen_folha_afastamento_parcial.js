/*
 * Aplica o afastamento PARCIAL nas QUATRO copias da geracao de folha.
 *
 * As quatro sao executeGerarFolhaPonto / sincronizarFolhaPonto (folha-ponto/actions.ts) e
 * gerarFolhaPontoServidor / sincronizarFolhaPontoServidor (consultar-escala/actions.ts) — o
 * CLAUDE.md registra que elas ja divergiram entre si, entao a mudanca sai por script com
 * contagem, nunca a mao. Aborta se qualquer contagem divergir.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const ALVOS = [
  { arquivo: 'src/app/(dashboard)/folha-ponto/actions.ts', turnos: ['shift', 'currentShift'], virgula: true },
  { arquivo: 'src/app/consultar-escala/actions.ts', turnos: ['currentShift', 'shift'], virgula: false },
]

let totalSubs = 0

for (const alvo of ALVOS) {
  const p = path.join(RAIZ, alvo.arquivo)
  const bruto = fs.readFileSync(p, 'utf8')
  // Os .ts do projeto podem estar em CRLF (como as migrations). Normaliza para casar os padroes
  // e devolve no fim exatamente o EOL que o arquivo ja usava — mudar isso viraria diff inteiro.
  const eolCRLF = bruto.includes('\r\n')
  let s = eolCRLF ? bruto.replace(/\r\n/g, '\n') : bruto
  const antes = s

  // ---------------------------------------------------------------- 1. o veredito do dia
  // Uma linha por copia, cada uma com o nome proprio da variavel do turno.
  for (const turno of alvo.turnos) {
    const de = `      const afastamentosAnulantes = afastamentosDia.filter(af => isShiftOverlappingAfastamento(af, ${turno}))`
    const para =
      `      // Afastamento PARCIAL ({M} num turno MT) NAO anula o dia: o servidor trabalha a tarde,\n` +
      `      // e a folha precisa continuar aceitando os horarios dele. Ver avaliarAfastamentosNoTurno.\n` +
      `      const veredictoAfastamento = avaliarAfastamentosNoTurno(afastamentosDia, ${turno}, activeJornada?.nome)\n` +
      `      const afastamentosAnulantes = veredictoAfastamento.anulantes`
    const n = s.split(de).length - 1
    if (n !== 1) {
      console.error(`ABORTADO: ${alvo.arquivo} — esperava 1 "afastamentosAnulantes(${turno})", achou ${n}.`)
      process.exit(1)
    }
    s = s.split(de).join(para)
    totalSubs++
  }

  // -------------------------------------------------- 2. abono do meio periodo + os slots
  const v = alvo.virgula ? ',' : ''
  const deAbono = `        abono_minutos: minutosAbonadosDoDia(afastamentosDia)${v}\n`
  const paraAbono =
    `        abono_minutos: minutosAbonadosDoDia(afastamentosDia) + veredictoAfastamento.abonoParcialMinutos,\n` +
    `        // Preenchido so em dia PARCIAL. E o que impede calcularDia de acusar 5h de atraso em\n` +
    `        // quem apresentou declaracao de comparecimento pela manha — ver RegistroDia.\n` +
    `        afastamento_slots: veredictoAfastamento.slotsParciais.length > 0 ? veredictoAfastamento.slotsParciais : null${v}\n`
  const nAbono = s.split(deAbono).length - 1
  if (nAbono !== 2) {
    console.error(`ABORTADO: ${alvo.arquivo} — esperava 2 "abono_minutos", achou ${nAbono}.`)
    process.exit(1)
  }
  s = s.split(deAbono).join(paraAbono)
  totalSubs += nAbono

  // ------------------------------------------------------------------------- 3. o import
  const deImport = `import { afastamentosDoDia, descreverAfastamentos, isShiftOverlappingAfastamento, minutosAbonadosDoDia } from '@/utils/folha/afastamentosDia'`
  const deImport2 = `import { afastamentosDoDia, descreverAfastamentos, minutosAbonadosDoDia, isShiftOverlappingAfastamento } from '@/utils/folha/afastamentosDia'`
  const paraImport = `import { afastamentosDoDia, avaliarAfastamentosNoTurno, descreverAfastamentos, minutosAbonadosDoDia } from '@/utils/folha/afastamentosDia'`
  const alvoImport = s.includes(deImport) ? deImport : (s.includes(deImport2) ? deImport2 : null)
  if (!alvoImport) {
    console.error(`ABORTADO: ${alvo.arquivo} — import de afastamentosDia nao encontrado na forma esperada.`)
    process.exit(1)
  }
  s = s.split(alvoImport).join(paraImport)
  totalSubs++

  if (s === antes) {
    console.error(`ABORTADO: ${alvo.arquivo} — nada mudou.`)
    process.exit(1)
  }

  // ------------------------------------------------------------- conferencia por arquivo
  const conta = (re) => (s.match(re) || []).length
  const checks = [
    ['2 vereditos', conta(/const veredictoAfastamento = avaliarAfastamentosNoTurno\(/g) === 2],
    ['2 afastamentosAnulantes', conta(/const afastamentosAnulantes = veredictoAfastamento\.anulantes/g) === 2],
    ['2 abonos somando o parcial', conta(/\+ veredictoAfastamento\.abonoParcialMinutos/g) === 2],
    ['2 afastamento_slots', conta(/afastamento_slots: veredictoAfastamento\.slotsParciais/g) === 2],
    ['isShiftOverlappingAfastamento nao e mais usada aqui', conta(/isShiftOverlappingAfastamento/g) === 0],
    ['descreverAfastamentos preservada', conta(/descreverAfastamentos\(/g) >= 5],
    ['"AFASTAMENTO PARCIAL:" preservado 4x por copia', conta(/AFASTAMENTO PARCIAL:/g) === 8],
  ]
  let falhou = false
  for (const [nome, ok] of checks) {
    console.log((ok ? 'ok    ' : 'FALHA ') + alvo.arquivo + ' — ' + nome)
    if (!ok) falhou = true
  }
  if (falhou) {
    console.error('\nABORTADO: conferencia falhou. Nada foi escrito.')
    process.exit(1)
  }

  fs.writeFileSync(p, eolCRLF ? s.split('\n').join('\r\n') : s, 'utf8')
}

console.log('\nsubstituicoes aplicadas: ' + totalSubs)
