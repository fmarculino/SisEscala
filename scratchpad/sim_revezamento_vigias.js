// Portão de verificação do revezamento de vigias/agentes de portaria.
// Transpile antes: npx tsc src/utils/vigiaRevezamento.ts --outDir scratchpad/_sim --module commonjs --target es2020

const {
  classificarDiaVigia,
  turnosDoDiaVigia,
  gerarRevezamentoVigias,
  sugerirTurnosVigia,
  validarTurnosVigia,
  turnoServeParaCategoria,
  slotsDoDiaVigia,
  horaExtraPassagemTurno,
  mesclarRevezamentoNoGrid,
  construirContextoCalendarioVigia,
  contarDiasVigia,
} = require('./_sim/vigiaRevezamento.js')

let falhas = 0
function assert(cond, msg) {
  if (!cond) {
    falhas++
    console.error('FALHOU:', msg)
  }
}

const TURNOS = { regular: 'ID_N', plantao: 'ID_MT', extra: 'ID_1N' }
const permiteTudo = () => ({ permitido: true })

// Registra com que slots cada dia foi conferido — é isso que impede o guard de voltar a usar
// a união M+T+N em dia normal (afastamento parcial da manhã esvaziaria a noite).
function espiaoDeSlots(registro) {
  return (servidorId, dia, classificacao) => {
    registro.push({ dia, classificacao, slots: slotsDoDiaVigia(classificacao) })
    return { permitido: true }
  }
}

// ---------------------------------------------------------------------------
// 1. Agosto/2026 real: dia 1 = sábado (confirmado por cálculo de calendário).
// ---------------------------------------------------------------------------
const AGO2026 = { ano: 2026, mes: 8 }
assert(new Date(2026, 7, 1).getDay() === 6, 'pré-condição: 01/08/2026 é sábado')

const calendarioVazio = construirContextoCalendarioVigia([], [])

// ---------------------------------------------------------------------------
// 2. Alternância simples, 2 agentes, semana toda normal (sem feriado/fds no recorte)
// ---------------------------------------------------------------------------
{
  // 3 a 7 de agosto/2026 = segunda a sexta (dias normais)
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 3,
    daysInMonth: 7,
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  assert(dias.length === 5, 'dias 3-7 geram 5 registros')
  assert(dias.every(d => d.classificacao === 'normal'), 'seg-sex são todos normais')
  assert(dias.every(d => !d.pulado), 'nenhum pulado')
  assert(
    dias.map(d => d.servidorId).join('') === 'ABABA',
    'alternância simples A,B,A,B,A — obtido: ' + dias.map(d => d.servidorId).join('')
  )
  dias.forEach(d => {
    assert(d.turnos.length === 2, `dia normal grava 2 turnos (dia ${d.dia})`)
    assert(d.turnos.some(t => t.categoria === 'Regular' && t.turnoId === 'ID_N'), `Regular=N no dia ${d.dia}`)
    assert(d.turnos.some(t => t.categoria === 'Extra' && t.turnoId === 'ID_1N'), `Extra=1N no dia ${d.dia}`)
    assert(!d.turnos.some(t => t.categoria === 'Plantão'), `sem Plantão no dia normal ${d.dia}`)
  })
}

// ---------------------------------------------------------------------------
// 3. O caso do usuário: sexta(7)=A normal, sáb(8)+dom(9) sem-equipe, segunda(10)=B normal.
//    A deve pegar sexta E domingo; B pega só o sábado. Isso tem que sair da alternância
//    simples, sem nenhuma regra extra.
// ---------------------------------------------------------------------------
{
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A', // A está de plantão no dia 7 (sexta, startDay)
    startDay: 7,
    daysInMonth: 10,
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const porDia = Object.fromEntries(dias.map(d => [d.dia, d]))

  assert(porDia[7].classificacao === 'normal', 'dia 7 (sexta) é normal')
  assert(porDia[7].servidorId === 'A', 'sexta é do A')
  assert(porDia[7].turnos.length === 2 && porDia[7].turnos.some(t => t.categoria === 'Extra'), 'sexta = 12h+extra')

  assert(porDia[8].classificacao === 'sem_equipe', 'dia 8 (sábado) é sem-equipe')
  assert(porDia[8].servidorId === 'B', 'sábado é do B (revezamento simples)')
  assert(!porDia[8].viradaParaNormal, 'sábado NÃO é virada (domingo também é sem-equipe)')
  assert(
    porDia[8].turnos.length === 2 &&
    porDia[8].turnos.some(t => t.categoria === 'Plantão') &&
    !porDia[8].turnos.some(t => t.categoria === 'Extra'),
    'sábado = 24h SEM extra'
  )

  assert(porDia[9].classificacao === 'sem_equipe', 'dia 9 (domingo) é sem-equipe')
  assert(porDia[9].servidorId === 'A', 'domingo volta a ser do A — mesmo agente da sexta')
  assert(porDia[9].viradaParaNormal, 'domingo É virada (segunda é normal)')
  assert(
    porDia[9].turnos.length === 3 &&
    porDia[9].turnos.some(t => t.categoria === 'Plantão') &&
    porDia[9].turnos.some(t => t.categoria === 'Extra'),
    'domingo = 24h + 1h extra'
  )

  assert(porDia[10].classificacao === 'normal', 'dia 10 (segunda) é normal')
  assert(porDia[10].servidorId === 'B', 'segunda é do B')
}

// ---------------------------------------------------------------------------
// 4. Bloco de 3 dias sem-equipe (feriado emendado): sexta normal, sáb+dom+segunda-feriado
//    sem-equipe, terça normal. Com 2 agentes: sex=A, sáb=B, dom=A, seg(feriado)=B, ter=A.
// ---------------------------------------------------------------------------
{
  // set 2026: usar um feriado fictício numa terça pra emendar com o fim de semana anterior?
  // mais simples: forçar um feriado na SEGUNDA seguinte ao fim de semana de ago/2026 (dia 10).
  const calFeriadoSegunda = construirContextoCalendarioVigia([{ data: '2026-08-10' }], [])
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 7,
    daysInMonth: 11,
    ...AGO2026,
    calendario: calFeriadoSegunda,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const porDia = Object.fromEntries(dias.map(d => [d.dia, d]))
  assert(porDia[10].classificacao === 'sem_equipe', 'segunda-feriado é sem-equipe')
  assert(porDia[11].classificacao === 'normal', 'terça (dia seguinte ao feriado) é normal')

  assert(porDia[7].servidorId === 'A' && porDia[7].classificacao === 'normal', 'sexta=A normal')
  assert(porDia[8].servidorId === 'B' && !porDia[8].viradaParaNormal, 'sábado=B, meio do bloco')
  assert(porDia[9].servidorId === 'A' && !porDia[9].viradaParaNormal, 'domingo=A, meio do bloco (bloco de 3 dias)')
  assert(porDia[10].servidorId === 'B' && porDia[10].viradaParaNormal, 'segunda-feriado=B, É a virada')
  assert(porDia[11].servidorId === 'A' && porDia[11].classificacao === 'normal', 'terça=A normal')
}

// ---------------------------------------------------------------------------
// 5. Ponto facultativo PARCIAL não conta como sem-equipe.
// ---------------------------------------------------------------------------
{
  const calParcial = construirContextoCalendarioVigia(
    [],
    [{ data: '2026-08-11', inicio_liberacao_em: '13:00:00', fim_liberacao_em: null }]
  )
  const c = classificarDiaVigia(2026, 8, 11, calParcial)
  assert(c === 'normal', 'facultativo parcial (saída antecipada) não vira sem-equipe: obtido ' + c)
}

// ---------------------------------------------------------------------------
// 6. Ponto facultativo de DIA TODO conta como sem-equipe, mesmo em dia de semana.
// ---------------------------------------------------------------------------
{
  const calDiaTodo = construirContextoCalendarioVigia(
    [],
    [{ data: '2026-08-11', inicio_liberacao_em: null, fim_liberacao_em: null }]
  )
  const c = classificarDiaVigia(2026, 8, 11, calDiaTodo)
  assert(c === 'sem_equipe', 'facultativo de dia inteiro vira sem-equipe: obtido ' + c)
}

// ---------------------------------------------------------------------------
// 7. Três agentes revezando através de um fim de semana — cada dia sem-equipe vai para
//    um agente DIFERENTE (round-robin de 3), não necessariamente o mesmo par sexta/domingo.
// ---------------------------------------------------------------------------
{
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B', 'C'],
    servidorInicialId: 'A',
    startDay: 7,
    daysInMonth: 10,
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const seq = dias.map(d => d.servidorId).join('')
  assert(seq === 'ABCA', 'revezamento de 3 agentes: sex=A,sáb=B,dom=C,seg=A — obtido ' + seq)
}

// ---------------------------------------------------------------------------
// 8. Início do mês em dia sem-equipe (dia 1 = sábado) — não precisa olhar o mês anterior,
//    só classifica o próprio dia 1 e o seguinte.
// ---------------------------------------------------------------------------
{
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 1,
    daysInMonth: 3,
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const porDia = Object.fromEntries(dias.map(d => [d.dia, d]))
  assert(porDia[1].classificacao === 'sem_equipe', 'dia 1 (sábado) é sem-equipe')
  assert(porDia[2].classificacao === 'sem_equipe', 'dia 2 (domingo) é sem-equipe')
  assert(porDia[3].classificacao === 'normal', 'dia 3 (segunda) é normal')
  assert(porDia[2].viradaParaNormal, 'dia 2 é a virada (segunda é normal)')
  assert(!porDia[1].viradaParaNormal, 'dia 1 não é virada (dia 2 ainda é sem-equipe)')
}

// ---------------------------------------------------------------------------
// 9. Fim do mês em dia sem-equipe — precisa olhar o dia 1 do mês SEGUINTE (setembro/2026,
//    que começa numa terça-feira, dia normal) sem carregar o mês inteiro.
// ---------------------------------------------------------------------------
{
  assert(new Date(2026, 8, 1).getDay() === 2, 'pré-condição: 01/09/2026 é terça (normal)')
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 29, // sábado 29/08/2026
    daysInMonth: 31, // 31/08/2026 é segunda
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const porDia = Object.fromEntries(dias.map(d => [d.dia, d]))
  assert(porDia[31].classificacao === 'normal', 'dia 31/08 (segunda) é normal — não deveria nem chegar aqui como sem-equipe')
  // 29 e 30 são sábado/domingo; 31 é segunda (normal) — o próprio mês já resolve. Testar a
  // virada quando o ÚLTIMO dia do range gerado ainda é sem-equipe:
  const diasAte30 = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 29,
    daysInMonth: 30, // range termina no domingo — dia 31 (fora do range) precisa ser olhado mesmo assim
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const p2 = Object.fromEntries(diasAte30.map(d => [d.dia, d]))
  assert(p2[30].classificacao === 'sem_equipe', 'dia 30 (domingo) é sem-equipe')
  assert(p2[30].viradaParaNormal, 'dia 30 é virada mesmo sendo o ÚLTIMO dia do range gerado (31 é normal)')
}

// ---------------------------------------------------------------------------
// 10. Dia pulado (afastamento/presença/conflito) no meio do revezamento: não escreve nada,
//     mas o revezamento avança normalmente pro próximo (não redistribui a vaga perdida).
// ---------------------------------------------------------------------------
{
  const pulaDiaB = (servidorId, dia) =>
    (dia === 4) ? { permitido: false, motivo: 'afastamento' } : { permitido: true }

  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 3,
    daysInMonth: 6,
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: pulaDiaB,
  })
  const porDia = Object.fromEntries(dias.map(d => [d.dia, d]))
  assert(porDia[3].servidorId === 'A' && !porDia[3].pulado, 'dia 3 = A, normal')
  assert(porDia[4].servidorId === 'B' && porDia[4].pulado, 'dia 4 = B, PULADO')
  assert(porDia[4].turnos.length === 0, 'dia pulado não grava turno nenhum')
  assert(porDia[5].servidorId === 'A' && !porDia[5].pulado, 'dia 5 volta pro A — revezamento avançou normalmente')
  assert(porDia[6].servidorId === 'B' && !porDia[6].pulado, 'dia 6 = B de novo, sem redistribuição')

  const { porServidor, pulados } = contarDiasVigia(dias)
  assert(pulados === 1, '1 dia pulado contado')
  assert(porServidor.get('A') === 2 && porServidor.get('B') === 1, 'contagem por servidor bate (A:2, B:1)')
}

// ---------------------------------------------------------------------------
// 11. sugerirTurnosVigia / validarTurnosVigia — o tipo do turno tem que bater com a linha.
// ---------------------------------------------------------------------------
{
  const CATALOGO = [
    { id: 'id-n', codigo: 'N', tipo: 'Normal,Plantão', ativo: true },
    { id: 'id-mt', codigo: 'MT', tipo: 'Normal,Plantão,Extra', ativo: true },
    { id: 'id-1n', codigo: '1N', tipo: 'Extra', ativo: true },
    { id: 'id-1', codigo: '1', tipo: 'Extra', ativo: true },
    { id: 'id-t', codigo: 'T', tipo: 'Normal,Plantão', ativo: true },
  ]

  const sugestao = sugerirTurnosVigia(CATALOGO)
  assert(sugestao.regular === 'id-n', 'sugere N para a noite')
  assert(sugestao.plantao === 'id-mt', 'sugere MT para o dia inteiro')
  assert(sugestao.extra === 'id-1n', 'sugere 1N para a extra quando existe')

  const semNoturna = sugerirTurnosVigia(CATALOGO.filter(t => t.codigo !== '1N'))
  assert(semNoturna.extra === 'id-1', 'cai para o código 1 quando não existe 1N')

  const ok = validarTurnosVigia(CATALOGO, { regular: 'id-n', plantao: 'id-mt', extra: 'id-1n' })
  assert(ok.ok === true, 'escolha coerente é aceita')

  // O `1N` é tipo Extra: não pode ser lançado na linha Regular.
  const tipoErrado = validarTurnosVigia(CATALOGO, { regular: 'id-1n', plantao: 'id-mt', extra: 'id-1n' })
  assert(tipoErrado.ok === false, 'turno de tipo Extra é recusado na linha Regular')

  // Turno inativo não serve para linha nenhuma.
  const inativo = validarTurnosVigia(
    CATALOGO.map(t => t.codigo === 'MT' ? { ...t, ativo: false } : t),
    { regular: 'id-n', plantao: 'id-mt', extra: 'id-1n' }
  )
  assert(inativo.ok === false, 'turno inativo é recusado')

  const faltando = validarTurnosVigia(CATALOGO, { regular: 'id-n', plantao: '', extra: 'id-1n' })
  assert(faltando.ok === false, 'escolha incompleta é recusada')

  assert(turnoServeParaCategoria(CATALOGO[1], 'Plantão') === true, 'MT serve para Plantão')
  assert(turnoServeParaCategoria(CATALOGO[0], 'Extra') === false, 'N não serve para Extra')
}

// ---------------------------------------------------------------------------
// 11b. horaExtraPassagemTurno — a hora da extra é o FIM da jornada. Sem ela a célula fica
//      "?h" e hora_inicio_prevista vai nula ao banco.
// ---------------------------------------------------------------------------
{
  assert(horaExtraPassagemTurno('18H ÀS 06H') === '06:00', 'jornada 18H ÀS 06H → extra às 06:00')
  assert(horaExtraPassagemTurno('19H ÀS 07H') === '07:00', 'jornada 19H ÀS 07H → extra às 07:00')
  assert(horaExtraPassagemTurno('08H ÁS 18H') === '18:00', 'aceita "ÁS" com A agudo (existe no catálogo)')
  assert(horaExtraPassagemTurno('PLANTAO NOTURNO') === null, 'jornada sem hora no nome devolve null, não inventa')
  assert(horaExtraPassagemTurno(null) === null, 'jornada ausente devolve null')
}

// ---------------------------------------------------------------------------
// 11c. Os slots conferidos são os do TIPO DE DIA — dia normal é só a noite.
// ---------------------------------------------------------------------------
{
  assert(JSON.stringify(slotsDoDiaVigia('normal')) === JSON.stringify(['N']), 'dia normal confere só o slot N')
  assert(JSON.stringify(slotsDoDiaVigia('sem_equipe')) === JSON.stringify(['M', 'T', 'N']), 'dia sem equipe confere M, T e N')

  const registro = []
  gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 7,   // sexta (normal)
    daysInMonth: 8, // sábado (sem equipe)
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: espiaoDeSlots(registro),
  })
  const sexta = registro.find(r => r.dia === 7)
  const sabado = registro.find(r => r.dia === 8)
  assert(JSON.stringify(sexta.slots) === JSON.stringify(['N']), 'sexta (normal) é conferida só contra o slot N')
  assert(JSON.stringify(sabado.slots) === JSON.stringify(['M', 'T', 'N']), 'sábado (24h) é conferido contra M, T e N')
}

// ---------------------------------------------------------------------------
// 12. mesclarRevezamentoNoGrid — junta várias categorias/dias/servidores corretamente e
//     ignora dias pulados.
// ---------------------------------------------------------------------------
{
  const dias = gerarRevezamentoVigias({
    servidorIds: ['A', 'B'],
    servidorInicialId: 'A',
    startDay: 7,
    daysInMonth: 10,
    ...AGO2026,
    calendario: calendarioVazio,
    turnos: TURNOS,
    podeEscalarDia: permiteTudo,
  })
  const merge = mesclarRevezamentoNoGrid(dias)
  assert(merge.A.Regular[7] === 'ID_N', 'A tem Regular no dia 7')
  assert(merge.A.Extra[7] === 'ID_1N', 'A tem Extra no dia 7')
  assert(merge.B.Plantão[8] === 'ID_MT', 'B tem Plantão no dia 8 (sábado)')
  assert(!merge.B.Extra || merge.B.Extra[8] === undefined, 'B NÃO tem Extra no dia 8 (não é virada)')
  assert(merge.A.Plantão[9] === 'ID_MT' && merge.A.Extra[9] === 'ID_1N', 'A tem Plantão+Extra no dia 9 (virada)')
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`)
  process.exit(1)
} else {
  console.log('OK — todas as verificações do revezamento de vigias passaram.')
}
