/*
 * Aplica em ScaleGrid.tsx a validacao cronologica ciente de turno que atravessa a meia-noite.
 *
 * Padrao da casa (CLAUDE.md armadilha 1): substituicao pontual por script, com CONTAGEM
 * conferida — o arquivo tem ~7.700 linhas e redigitar trecho a mao ja apagou logica critica
 * seis vezes no SQL. Aborta se qualquer ancora nao aparecer exatamente uma vez.
 */
const fs = require('fs')
const path = require('path')

const ARQ = path.join(__dirname, '..', 'src', 'app', '(dashboard)', 'escalas', 'unidade', '[unidadeId]', 'ScaleGrid.tsx')
let bruto = fs.readFileSync(ARQ, 'utf8')
// O arquivo esta em CRLF (convencao do repo). As ancoras deste script sao escritas em LF:
// normaliza para casar, e devolve CRLF ao gravar. Aborta se o arquivo nao for uniforme —
// reescrever EOL de linha que ninguem tocou poluiria o diff inteiro.
const nLinhas = (bruto.match(/\n/g) || []).length
const nCrlf = (bruto.match(/\r\n/g) || []).length
if (nCrlf !== 0 && nCrlf !== nLinhas) throw new Error('arquivo com EOL misto; nao vou reescrever')
const ERA_CRLF = nCrlf === nLinhas && nCrlf > 0
let src = bruto.replace(/\r\n/g, '\n')
const antes = src

function trocar(de, para, esperado = 1) {
  const partes = src.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    throw new Error(`ancora encontrada ${achou}x, esperado ${esperado}x:\n---\n${de.slice(0, 160)}\n---`)
  }
  src = partes.join(para)
}

// 1. Import da fonte unica.
trocar(
  `import { formatarData, formatarDataHora, formatarHora, formatarHoraComSegundos } from '@/utils/horario'`,
  `import { formatarData, formatarDataHora, formatarHora, formatarHoraComSegundos, dataISOLocal } from '@/utils/horario'
import { avaliarSequenciaPresenca, type PassoPresenca } from '@/utils/sequenciaPresenca'`
)

// 2. O tipo passa a vir do util — duas definicoes iguais divergem na primeira alteracao.
trocar(
  `type PassoPresenca = 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida'\n`,
  ``
)

// 3. Helper: este dia atravessa a meia-noite? Fica ao lado de blocoDaCelula, que e a fonte
//    preferida da resposta.
trocar(
  `  // O previsto DESTA linha dentro do bloco, quando o bloco funde mais de um turno.`,
  `  // Este dia termina no dia seguinte?
  //
  // A resposta vem do PREVISTO do bloco (fn_blocos_previstos_mes, a mesma fonte que o terminal
  // cobra): inicio e fim em dias civis diferentes. Quando o previsto ainda nao chegou — ou a
  // celula acabou de ser lancada e nem tem escala_diaria_id —, cai no codigo do turno pelo mesmo
  // getShiftEndHour que a grade ja usa para desenhar (> 24 = vira o dia).
  //
  // ⚠️ NUNCA deduzir isso do horario digitado. Era o que produzia o remendo \`mSai > 360\`, que
  // aceitava saida ate as 06:00 e recusava as 07:00 de um plantao \`N\`.
  const celulaCruzaMeiaNoite = useCallback((servidorId?: string, cat?: string, day?: number) => {
    const bloco = blocoDaCelula(servidorId, cat, day)
    const ini = bloco?.inicio_previsto
    const fim = bloco?.fim_previsto
    if (ini && fim) {
      const dIni = dataISOLocal(ini)
      const dFim = dataISOLocal(fim)
      if (dIni && dFim) return dIni !== dFim
    }
    const em = escalaMensal.find(e => e.servidor_id === servidorId)
    const turnoId = day && cat ? em?.dias?.[day]?.[cat] : undefined
    const turno = turnos.find(t => t.id === turnoId)
    if (!turno?.codigo) return false
    return getShiftEndHour(turno.codigo, Number(turno.horas_computadas)) > 24
  }, [blocoDaCelula, escalaMensal, turnos, getShiftEndHour])

  // O previsto DESTA linha dentro do bloco, quando o bloco funde mais de um turno.`
)

// 4. A validacao propriamente dita.
const INICIO = `      // Validação de consistência cronológica dos horários (Portaria 671/2021 e CLT)`
const FIM = `      if (mEnt !== null && mSai !== null && !fIntSai && !fIntRet && mSai <= mEnt && mSai > 360) {
        setAlertModal({
          isOpen: true,
          title: 'Horários Inconsistentes',
          message: \`A saída (\${fSai}) não pode ser anterior ou igual à entrada (\${fEnt}).\`,
          type: 'warning'
        })
        return
      }`

const i = src.indexOf(INICIO)
const j = src.indexOf(FIM)
if (i < 0 || j < 0 || j < i) throw new Error('nao localizei o bloco de validacao cronologica')
const trecho = src.slice(i, j + FIM.length)
if ((src.split(INICIO).length - 1) !== 1 || (src.split(FIM).length - 1) !== 1) {
  throw new Error('ancoras do bloco de validacao aparecem mais de uma vez')
}
// Guards que o trecho novo precisa preservar: sao eles que decidem o horario final de cada passo.
for (const invariante of ['getFinalPassoHora', 'manualPresenceModal.selecoes?.[p]?.hora', 'diaPres?.saida_em']) {
  if (!trecho.includes(invariante)) throw new Error(`invariante ausente no trecho antigo: ${invariante}`)
}

const NOVO = `      // Ordem cronológica dos passos. Fonte única: src/utils/sequenciaPresenca.ts.
      //
      // ⚠️ COMPARAR MINUTOS DO MESMO DIA CIVIL RECUSA TODO PLANTÃO QUE ATRAVESSA A MEIA-NOITE.
      // Entrada 19:00, intervalo 22:00/23:00 e saída 07:00 é a sequência CORRETA de um \`N\` — a
      // saída é do dia seguinte. Até 01/09/2026 a tela respondia "a saída final (07:00) não pode
      // ser anterior ou igual ao retorno do intervalo (23:00)" e a validação não tinha como ser
      // concluída. O remendo que existia (\`mSai > 360\`) aceitava saída até 06:00 e recusava
      // justamente as 07:00 em que a família \`N\`/\`T?N\`/\`MTN\` termina.
      const diaPres = presenceData[manualPresenceModal.servidorId]?.[manualPresenceModal.categoria]?.[manualPresenceModal.dia]
      const toHHMM = (isoOrTime?: string | null) => {
        if (!isoOrTime) return null
        if (isoOrTime.includes('T')) {
          return formatarHora(isoOrTime)
        }
        return isoOrTime.slice(0, 5)
      }

      const getFinalPassoHora = (p: PassoPresenca) => {
        if (manualPresenceModal.selecoes?.[p]?.hora) return manualPresenceModal.selecoes[p]!.hora.slice(0, 5)
        if (manualPresenceModal.horarios?.[p]) return manualPresenceModal.horarios[p].slice(0, 5)
        if (p === 'entrada') return toHHMM(diaPres?.entrada_em)
        if (p === 'intervalo_saida') return toHHMM(diaPres?.intervalo_saida_em)
        if (p === 'intervalo_retorno') return toHHMM(diaPres?.intervalo_retorno_em)
        if (p === 'saida') return toHHMM(diaPres?.saida_em)
        return null
      }

      const seq = avaliarSequenciaPresenca({
        entrada: getFinalPassoHora('entrada'),
        intervalo_saida: getFinalPassoHora('intervalo_saida'),
        intervalo_retorno: getFinalPassoHora('intervalo_retorno'),
        saida: getFinalPassoHora('saida'),
      }, {
        cruzaMeiaNoite: celulaCruzaMeiaNoite(
          manualPresenceModal.servidorId, manualPresenceModal.categoria, manualPresenceModal.dia),
      })

      if (!seq.ok) {
        setAlertModal({
          isOpen: true,
          title: 'Horários Inconsistentes',
          message: seq.mensagem || 'Os horários informados não formam uma sequência válida.',
          type: 'warning'
        })
        return
      }`

src = src.slice(0, i) + NOVO + src.slice(j + FIM.length)

if (src === antes) throw new Error('nada mudou')
fs.writeFileSync(ARQ, ERA_CRLF ? src.replace(/\n/g, '\r\n') : src)
console.log('ScaleGrid.tsx atualizado.')
