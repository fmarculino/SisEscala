// Portao da montagem do documento de apuracao (Fase 2 do plano do Mais Medicos).
//
// 🚨 O caso central deste portao e o das DUAS REGUAS: a apuracao 21/08 -> 20/09 tem os dias de
// agosto valendo 10h (vao bruto) e os de setembro valendo 8h (liquido), porque
// horas_normais_liquidas_desde = 2026-09. Somar o periodo com UMA chamada a totaisFolha tiraria
// 2h de cada dia de agosto: -40h nas 4 apuracoes reais, num documento que o servidor assina.
//
// Transpile antes:
//   npx tsc src/utils/folha/apuracaoPeriodo.ts --outDir scratchpad/_sim --module commonjs --target es2020 --skipLibCheck
//
// Uso: node scratchpad/sim_apuracao_periodo.js
const A = require('./_sim/apuracaoPeriodo.js')
const P = require('./_sim/periodoApuracao.js')

let ok = 0, falhas = 0
function t(nome, cond, extra) {
  if (cond) { ok++; return }
  falhas++
  console.error(`  REPROVA: ${nome}${extra !== undefined ? ' -> ' + extra : ''}`)
}

const C20 = { id: 'r-20', nome: 'Fechamento no dia 20', dia_corte: 20 }
const CIVIL = { id: 'r-civil', nome: 'Mes civil', dia_corte: null, padrao: true }

// A jornada real dos 4 medicos: 08H AS 18H, vao de 10h, intervalo de 120 min -> liquido 8h.
const JORNADA = { nome: '08H ÀS 18H', horas_totais: 10, intervalo_minutos: 120 }

// Um dia trabalhado, com turno lancado e horario batido.
function dia(d, extra = {}) {
  return {
    dia: d, dia_semana: 'Seg', turno_codigo: 'R',
    entrada: '08:00', saida_intervalo: '12:00', retorno_intervalo: '14:00', saida: '18:00',
    hora_extra_minutos: 0, hora_extra_tipo: null, observacao: '', abono_minutos: 0,
    jornada_nome: '08H ÀS 18H',
    origem_entrada: 'real', origem_saida: 'real',
    origem_saida_intervalo: 'real', origem_retorno_intervalo: 'real',
    ...extra,
  }
}

function folha(mes, ano, diasLista, extra = {}) {
  return {
    id: `f-${ano}-${mes}`, mes, ano, status: 'Gerada',
    registros: diasLista.map(d => (typeof d === 'number' ? dia(d) : d)),
    unidade_nome: 'USF ENFERMEIRA ZEZINHA', setor_nome: 'MAIS MEDICOS',
    jornada: JORNADA,
    ...extra,
  }
}

const VIG = {
  horasLiquidasDesde: '2026-09',
  compensacaoVigenteDesde: '2026-09',
  autorizacaoExtraVigenteDesde: '2026-09',
}

// ============================================================ 1. as duas réguas
console.log('1. 🚨 as duas reguas — cada metade com a carga da competencia dela')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  // 6 dias trabalhados em agosto (dias 21..31) e 7 em setembro (dias 1..20), como nos 4 medicos.
  const ago = folha(8, 2026, [21, 24, 25, 26, 27, 31], { status: 'Revisada' })
  const set = folha(9, 2026, [1, 2, 3, 4, 8, 9, 10])
  const r = A.montarApuracao(janela, [ago, set], VIG)

  t('duas metades apuradas', r.metades.length === 2, String(r.metades.length))
  const m8 = r.metades.find(m => m.competencia === '2026-08')
  const m9 = r.metades.find(m => m.competencia === '2026-09')

  t('agosto usa o VAO BRUTO (10h/dia)', m8?.horasNormaisPorDia === 10, String(m8?.horasNormaisPorDia))
  t('agosto NAO desconta intervalo', m8?.descontaIntervalo === false)
  t('setembro usa o LIQUIDO (8h/dia)', m9?.horasNormaisPorDia === 8, String(m9?.horasNormaisPorDia))
  t('setembro desconta intervalo', m9?.descontaIntervalo === true)

  // A conta que prova o ponto: 6 x 10h + 7 x 8h = 116h. Uma chamada só com mes=9 daria
  // 13 x 8h = 104h — 12h a menos, exatamente o defeito medido em produção.
  t('total = 6x10h + 7x8h = 116h (nunca 13x8h = 104h)',
    r.totais.normaisMinutos === (6 * 10 + 7 * 8) * 60,
    `${r.totais.normaisMinutos} min = ${r.totais.normaisMinutos / 60}h`)
  t('a soma das metades bate com o total',
    (m8.totais.normaisMinutos + m9.totais.normaisMinutos) === r.totais.normaisMinutos)
  t('atravessaCompetencia sinalizado', r.atravessaCompetencia === true)
}

// ============================================================ 2. ordem por data
console.log('2. a ordem e por DATA, nunca por numero de dia')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const r = A.montarApuracao(janela, [folha(8, 2026, [21, 31]), folha(9, 2026, [1, 20])], VIG)

  t('31 dias no documento', r.dias.length === 31, String(r.dias.length))
  t('o primeiro dia e 21/08', r.dias[0].data === '2026-08-21', r.dias[0].data)
  t('o ultimo dia e 20/09', r.dias[r.dias.length - 1].data === '2026-09-20', r.dias[r.dias.length - 1].data)

  // Sem ordenar por data, o dia 1 (numero menor) vinha antes do dia 21.
  const datas = r.dias.map(d => d.data)
  t('as datas estao em ordem crescente',
    datas.every((d, i) => i === 0 || datas[i - 1] <= d))
  const idx21ago = datas.indexOf('2026-08-21')
  const idx01set = datas.indexOf('2026-09-01')
  t('21/08 vem ANTES de 01/09', idx21ago < idx01set, `${idx21ago} vs ${idx01set}`)

  t('cada dia carrega a competencia dele',
    r.dias.find(d => d.data === '2026-08-25').competencia === '2026-08'
    && r.dias.find(d => d.data === '2026-09-05').competencia === '2026-09')
  t('o numero do dia dentro da competencia e preservado',
    r.dias.find(d => d.data === '2026-09-05').dia === 5)
}

// =============================================== 3. caso de borda 1: falta uma metade
console.log('3. borda 1 — falta uma metade: PARCIAL, nunca zero')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const r = A.montarApuracao(janela, [folha(9, 2026, [1, 2, 3])], VIG)

  t('marcado como parcial', r.parcial === true)
  t('a metade sem folha e sinalizada',
    r.metades.find(m => m.competencia === '2026-08')?.semFolha === true)
  const lac = r.lacunas.find(l => l.motivo === 'sem_folha')
  t('a lacuna nomeia a competencia', lac?.competencia === '2026-08', lac?.competencia)
  t('a lacuna lista os 11 dias de agosto', lac?.dias.length === 11, String(lac?.dias.length))
  t('a lacuna explica por escrito', typeof lac?.descricao === 'string' && lac.descricao.length > 20)
  t('o total conta SO a metade que existe (3 x 8h)',
    r.totais.normaisMinutos === 3 * 8 * 60, String(r.totais.normaisMinutos / 60))
  t('exige confirmacao antes de emitir', A.requerConfirmacao(r).precisa === true)
  t('o motivo da confirmacao cita a competencia faltante',
    A.requerConfirmacao(r).motivos.some(m => m.includes('2026-08')))
}

// ======================================== 4. caso de borda 2: duas folhas na mesma metade
console.log('4. borda 2 — duas folhas na mesma competencia (escala dividida)')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const f1 = folha(9, 2026, [1, 2, 3], { id: 'f-a', setor_nome: 'AMBULATÓRIO CLÍNICO' })
  const f2 = { ...folha(9, 2026, [10, 11]), id: 'f-b', setor_nome: 'MAIS MEDICOS' }
  const r = A.montarApuracao(janela, [folha(8, 2026, [21, 22]), f1, f2], VIG)

  const m9 = r.metades.find(m => m.competencia === '2026-09')
  t('as duas folhas entram na metade', m9?.folhas.length === 2, String(m9?.folhas.length))
  t('os dias das DUAS folhas sao somados (5 dias de setembro)',
    m9?.diasComRegistro === 5, String(m9?.diasComRegistro))
  t('o total soma 2x10h (ago) + 5x8h (set)',
    r.totais.normaisMinutos === (2 * 10 + 5 * 8) * 60, String(r.totais.normaisMinutos / 60))

  // Escolher uma das duas apagaria metade do mes de alguem.
  t('as DUAS lotacoes aparecem',
    r.lotacoes.filter(l => l.competencia === '2026-09').length === 2,
    JSON.stringify(r.lotacoes))
  t('a lotacao de agosto tambem aparece',
    r.lotacoes.some(l => l.competencia === '2026-08'))
}

// ============================ 5. caso de borda 3: lotacao diferente entre as metades
console.log('5. borda 3 — a lotacao muda no meio do periodo')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const ago = folha(8, 2026, [21, 22], { setor_nome: 'AMBULATÓRIO CLÍNICO' })
  const set = folha(9, 2026, [1, 2], { setor_nome: 'MAIS MEDICOS' })
  const r = A.montarApuracao(janela, [ago, set], VIG)

  t('as duas lotacoes vao no documento', r.lotacoes.length === 2, String(r.lotacoes.length))
  t('a de agosto e a de origem',
    r.lotacoes.find(l => l.competencia === '2026-08')?.setor_nome === 'AMBULATÓRIO CLÍNICO')
  t('a de setembro e a nova',
    r.lotacoes.find(l => l.competencia === '2026-09')?.setor_nome === 'MAIS MEDICOS')
  t('o relato diz que a lotacao muda',
    A.descreverApuracao(r).some(l => /lota..o muda/i.test(l)),
    JSON.stringify(A.descreverApuracao(r)))
}

// ================================ 6. caso de borda 4: competencia encerrada
console.log('6. borda 4 — metade em competencia encerrada entra, marcada como congelada')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const r = A.montarApuracao(janela, [folha(8, 2026, [21, 22]), folha(9, 2026, [1])], {
    ...VIG,
    competenciasEncerradas: [{ mes: 8, ano: 2026 }],
  })

  t('agosto marcada como congelada',
    r.metades.find(m => m.competencia === '2026-08')?.congelada === true)
  t('setembro NAO congelada',
    r.metades.find(m => m.competencia === '2026-09')?.congelada === false)
  // Congelada e leitura: entra normalmente. E o estado desejavel — aquele lado nao se move mais.
  t('a metade congelada CONTINUA somando',
    r.metades.find(m => m.competencia === '2026-08')?.totais?.normaisMinutos === 2 * 10 * 60)
  t('o relato avisa que esta congelada',
    A.descreverApuracao(r).some(l => /congelado|encerrada/i.test(l)))
}

// =========================== 7. caso de borda 5: pendencia de decisao
console.log('7. borda 5 — pendencia de decisao sai com a COMPETENCIA ao lado')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  // Atraso na entrada + saida depois do previsto no MESMO dia 5 das duas competencias: e o caso
  // que prova por que a lista de dias precisa da competencia — "dia 5" existe nos dois lados.
  const atrasado = d => dia(d, { entrada: '08:20', saida: '18:30' })
  const r = A.montarApuracao(
    janela,
    [folha(8, 2026, [21, atrasado(25)]), folha(9, 2026, [atrasado(5), 10])],
    VIG
  )

  // Em agosto a regra de compensacao ainda nao vale (vigencia 2026-09): nada pendente lá.
  const p8 = r.pendencias.filter(p => p.competencia === '2026-08')
  const p9 = r.pendencias.filter(p => p.competencia === '2026-09')
  t('agosto (antes da vigencia) nao gera pendencia', p8.length === 0, JSON.stringify(p8))
  t('setembro gera pendencia', p9.length > 0, JSON.stringify(p9))
  t('toda pendencia carrega a competencia',
    r.pendencias.every(p => /^\d{4}-\d{2}$/.test(p.competencia)))
  t('toda pendencia carrega o tipo',
    r.pendencias.every(p => p.tipo === 'compensacao' || p.tipo === 'autorizacao_extra'))
  t('exige confirmacao', A.requerConfirmacao(r).precisa === true)
  t('o relato nomeia o artigo',
    A.descreverApuracao(r).some(l => /Art\. 7|Art\. 8/.test(l)),
    JSON.stringify(A.descreverApuracao(r)))
}

// ============================================================ 8. mes civil
console.log('8. mes civil — uma metade, e o total e o da folha do mes')
{
  const janela = P.janelaDoPeriodo(CIVIL, 9, 2026)
  const r = A.montarApuracao(janela, [folha(9, 2026, [1, 2, 3, 4, 5])], VIG)

  t('uma metade so', r.metades.length === 1, String(r.metades.length))
  t('atravessaCompetencia = false', r.atravessaCompetencia === false)
  t('30 dias (setembro inteiro)', r.dias.length === 30, String(r.dias.length))
  t('nao e parcial', r.parcial === false)
  t('total = 5 x 8h', r.totais.normaisMinutos === 5 * 8 * 60, String(r.totais.normaisMinutos / 60))
  t('o primeiro dia e 01/09', r.dias[0].data === '2026-09-01')
}

// =============================================== 9. dia sem registro na folha
console.log('9. dia do periodo sem linha na folha e LACUNA, nunca silencio')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  // A folha de setembro existe mas so tem o dia 1: os dias 2..20 nao tem linha.
  const r = A.montarApuracao(janela, [folha(8, 2026, [21]), folha(9, 2026, [1])], VIG)

  const lac = r.lacunas.find(l => l.motivo === 'dia_sem_registro' && l.competencia === '2026-09')
  t('a lacuna de dia sem registro existe', !!lac)
  t('lista os 19 dias sem linha', lac?.dias.length === 19, String(lac?.dias.length))
  t('NAO e marcado como parcial (a folha existe)', r.parcial === false)
  t('exige confirmacao mesmo assim', A.requerConfirmacao(r).precisa === true)
  t('o dia sem registro fica no documento, marcado',
    r.dias.find(d => d.data === '2026-09-05')?.semRegistro === true)
  t('e com registro nulo', r.dias.find(d => d.data === '2026-09-05')?.registro === null)
}

// =============================================== 10. o recorte nao vaza dias de fora
console.log('10. o recorte NAO pega dia de fora do periodo')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  // A folha de agosto tem o mes inteiro; so os dias > 20 podem entrar.
  const agoInteiro = folha(8, 2026, Array.from({ length: 31 }, (_, i) => i + 1), { status: 'Revisada' })
  const setInteiro = folha(9, 2026, Array.from({ length: 30 }, (_, i) => i + 1))
  const r = A.montarApuracao(janela, [agoInteiro, setInteiro], VIG)

  t('31 dias, nunca 61', r.dias.length === 31, String(r.dias.length))
  t('nenhum dia <= 20 de agosto entrou',
    !r.dias.some(d => d.competencia === '2026-08' && d.dia <= 20))
  t('nenhum dia > 20 de setembro entrou',
    !r.dias.some(d => d.competencia === '2026-09' && d.dia > 20))
  t('agosto conta 11 dias', r.metades.find(m => m.competencia === '2026-08').diasComRegistro === 11)
  t('setembro conta 20 dias', r.metades.find(m => m.competencia === '2026-09').diasComRegistro === 20)
  t('total = 11x10h + 20x8h = 270h',
    r.totais.normaisMinutos === (11 * 10 + 20 * 8) * 60, String(r.totais.normaisMinutos / 60))
  t('sem lacuna nenhuma', r.lacunas.length === 0, JSON.stringify(r.lacunas))
  t('nao exige confirmacao por lacuna',
    !A.requerConfirmacao(r).motivos.some(m => /sem linha|parcial/.test(m)))
}

// =============================================== 11. o relato conta o que ficou de fora
console.log('11. o relato conta o que ENTROU e o que ficou de fora (armadilha 22)')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const r = A.montarApuracao(janela, [folha(9, 2026, [1, 2])], VIG)
  const rel = A.descreverApuracao(r)

  t('o relato tem linhas', rel.length >= 2, String(rel.length))
  t('diz quantos dias o periodo tem', rel[0].includes('31 dias'), rel[0])
  t('diz quantos tem lancamento', /com lan.amento/.test(rel[0]), rel[0])
  t('nomeia a competencia SEM FOLHA', rel.some(l => /SEM FOLHA/.test(l)), JSON.stringify(rel))
  t('diz a carga por dia de cada metade', rel.some(l => /h por dia trabalhado/.test(l)))
}

// ============================== 12. fingerprint e deteccao de divergencia (Fase 3)
console.log('12. fingerprint — detecta que a folha mudou, sem congelar a folha')
{
  const janela = P.janelaDoPeriodo(C20, 9, 2026)
  const base = () => A.montarApuracao(janela, [folha(8, 2026, [21, 22]), folha(9, 2026, [1, 2])], VIG)

  const a1 = base()
  const fp1 = A.fingerprintApuracao(a1)
  t('fingerprint e string nao vazia', typeof fp1 === 'string' && fp1.length > 3, fp1)
  t('fingerprint e ESTAVEL: mesma entrada, mesmo valor', A.fingerprintApuracao(base()) === fp1)

  /*
    🚨 CADA CAMPO DO DIA, ISOLADO — e o isolamento e o ponto.

    A primeira versao deste teste mudava um campo via `montarApuracao` e exigia hash diferente.
    Isso NAO testava o fingerprint: mudar a entrada muda o atraso, que entra nos TOTAIS, que
    tambem estao no hash — entao o hash mudava mesmo com o campo fora dele. Tres injecoes do
    validador escaparam por causa disso (apagar entrada, apagar hora extra, apagar o dia sem
    registro).

    O teste certo compara dois documentos com TOTAIS IDENTICOS que diferem so no campo. E
    exatamente o que o fingerprint promete detectar: "algum horario mudou sem alterar os totais".
  */
  const totaisFixos = a1.totais
  const docComDia = (extra, dataAlvo = '2026-09-01') => ({
    janela,
    totais: totaisFixos,
    dias: a1.dias.map(d => d.data !== dataAlvo
      ? d
      : { ...d, registro: d.registro ? { ...d.registro, ...extra } : dia(1, extra) }),
  })

  const camposDoDia = [
    ['entrada', { entrada: '09:15' }],
    ['saida_intervalo', { saida_intervalo: '11:30' }],
    ['retorno_intervalo', { retorno_intervalo: '13:30' }],
    ['saida', { saida: '19:30' }],
    ['turno_codigo', { turno_codigo: 'MT' }],
    ['hora_extra_minutos', { hora_extra_minutos: 90 }],
    ['abono_minutos', { abono_minutos: 240 }],
    ['observacao', { observacao: 'FALTA' }],
  ]
  for (const [campo, mudanca] of camposDoDia) {
    t(`mudar ${campo} muda o fingerprint (com totais identicos)`,
      A.fingerprintApuracao(docComDia(mudanca)) !== fp1)
  }

  // Um dia que PERDE o registro, com os mesmos totais, tambem tem de mudar.
  const semRegistroNoDia = {
    janela,
    totais: totaisFixos,
    dias: a1.dias.map(d => d.data !== '2026-09-01' ? d : { ...d, registro: null, semRegistro: true }),
  }
  t('perder o registro de um dia muda o fingerprint (com totais identicos)',
    A.fingerprintApuracao(semRegistroNoDia) !== fp1)

  // E o contrario: os mesmos dias com TOTAIS diferentes tambem mudam o hash.
  t('total diferente muda o fingerprint',
    A.fingerprintApuracao({
      janela, dias: a1.dias,
      totais: { ...totaisFixos, normaisMinutos: totaisFixos.normaisMinutos + 60 },
    }) !== fp1)

  // Guardado para a comparacao com o emitido, mais abaixo.
  const comHorarioDiferente = A.montarApuracao(
    janela,
    [folha(8, 2026, [21, 22]), folha(9, 2026, [dia(1, { saida: '19:30' }), dia(2)])],
    VIG
  )

  // O que NAO deve mudar: o id da folha. Sincronizar a folha sem mexer em horario nao pode
  // aparecer como divergencia, senao o aviso vira ruido.
  const outroId = A.montarApuracao(
    janela,
    [{ ...folha(8, 2026, [21, 22]), id: 'OUTRO-ID' }, folha(9, 2026, [1, 2])],
    VIG
  )
  t('trocar o id da folha NAO muda o fingerprint', A.fingerprintApuracao(outroId) === fp1)

  // A janela entra: o mesmo conjunto de dias noutro periodo e outro documento.
  const outraJanela = A.montarApuracao(
    P.janelaDoPeriodo(C20, 10, 2026),
    [folha(9, 2026, [21, 22]), folha(10, 2026, [1, 2])],
    VIG
  )
  t('periodo diferente tem fingerprint diferente', A.fingerprintApuracao(outraJanela) !== fp1)

  t('diasComLinha conta os dias com registro', A.diasComLinha(a1) === 4, String(A.diasComLinha(a1)))

  // compararComEmitido
  const igual = A.compararComEmitido(base(), { fingerprint: fp1, totais: a1.totais })
  t('sem mudanca: NAO divergente', igual.divergente === false && igual.diferencas.length === 0)

  const mudou = A.compararComEmitido(comHorarioDiferente, { fingerprint: fp1, totais: a1.totais })
  t('com mudanca: divergente', mudou.divergente === true)
  t('a divergencia diz O QUE mudou, nunca so "mudou"',
    mudou.diferencas.length > 0 && mudou.diferencas.every(d => typeof d === 'string' && d.length > 5),
    JSON.stringify(mudou.diferencas))
  t('a diferenca nomeia o valor de antes e o de agora',
    mudou.diferencas.some(d => /emitido \d+.*hoje \d+/.test(d)) || mudou.diferencas.some(d => /hor.rio/.test(d)),
    JSON.stringify(mudou.diferencas))

  // Fingerprint diferente com totais iguais: tem de sair uma explicacao, nunca lista vazia.
  const fpFalso = A.compararComEmitido(base(), { fingerprint: 'nao-bate', totais: a1.totais })
  t('fingerprint diferente com totais iguais ainda explica',
    fpFalso.divergente === true && fpFalso.diferencas.length > 0, JSON.stringify(fpFalso.diferencas))
}

console.log(`\n${falhas === 0 ? 'OK' : 'REPROVADO'}: ${ok} assercoes passaram, ${falhas} falharam.`)
process.exit(falhas === 0 ? 0 : 1)
