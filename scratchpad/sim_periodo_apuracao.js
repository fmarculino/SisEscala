// Portao do regime de apuracao da folha (Fase 1 do plano do Mais Medicos).
//
// Transpile antes:
//   npx tsc src/utils/folha/periodoApuracao.ts --outDir scratchpad/_sim --module commonjs --target es2020
//
// Uso: node scratchpad/sim_periodo_apuracao.js
const fs = require('node:fs')
const path = require('node:path')
const P = require('./_sim/periodoApuracao.js')

let ok = 0, falhas = 0
function t(nome, cond, extra) {
  if (cond) { ok++; return }
  falhas++
  console.error(`  REPROVA: ${nome}${extra ? ' -> ' + extra : ''}`)
}

const CIVIL = { id: 'r-civil', nome: 'Mes civil', dia_corte: null, padrao: true, ativo: true }
const C20 = { id: 'r-20', nome: 'Fechamento no dia 20 (21 a 20)', dia_corte: 20, ativo: true }
const C28 = { id: 'r-28', nome: 'Corte 28', dia_corte: 28, ativo: true }
const C1 = { id: 'r-1', nome: 'Corte 1', dia_corte: 1, ativo: true }

// ---------------------------------------------------------------- 1. o caso que motivou
console.log('1. corte 20, competencia = o mes que FECHA (decisao do usuario, 16/09/2026)')
{
  const j = P.janelaDoPeriodo(C20, 9, 2026)
  t('09/2026 comeca em 21/08/2026', j.inicio === '2026-08-21', j.inicio)
  t('09/2026 termina em 20/09/2026', j.fim === '2026-09-20', j.fim)
  t('atravessaMes = true', j.atravessaMes === true)
  t('diaCorte preservado', j.diaCorte === 20)
  t('rotulo tem as DUAS datas', j.rotulo.includes('21/08/2026') && j.rotulo.includes('20/09/2026'), j.rotulo)
  // A outra leitura (nomear pelo mes que ABRE) daria 21/09 -> 20/10. Se um dia alguem trocar,
  // o documento desloca um mes inteiro e a diferenca so aparece no extrato do pagamento.
  t('NAO nomeia pelo mes que abre', j.inicio !== '2026-09-21', j.inicio)
}

// ---------------------------------------------------------------- 2. virada de ano
console.log('2. virada de ano')
{
  const jan = P.janelaDoPeriodo(C20, 1, 2026)
  t('01/2026 comeca em 21/12/2025', jan.inicio === '2025-12-21', jan.inicio)
  t('01/2026 termina em 20/01/2026', jan.fim === '2026-01-20', jan.fim)
  const dez = P.janelaDoPeriodo(C20, 12, 2026)
  t('12/2026 comeca em 21/11/2026', dez.inicio === '2026-11-21', dez.inicio)
  t('12/2026 termina em 20/12/2026', dez.fim === '2026-12-20', dez.fim)
}

// ---------------------------------------------------------------- 3. fevereiro
console.log('3. fevereiro, 28 e 29 dias')
{
  t('mes civil 02/2026 = 01 a 28', (() => {
    const j = P.janelaDoPeriodo(CIVIL, 2, 2026)
    return j.inicio === '2026-02-01' && j.fim === '2026-02-28'
  })())
  t('mes civil 02/2028 (bissexto) = 01 a 29', (() => {
    const j = P.janelaDoPeriodo(CIVIL, 2, 2028)
    return j.inicio === '2028-02-01' && j.fim === '2028-02-29'
  })())
  // 🚨 O caso que a formula ingenua ("dia_corte + 1 do mes anterior") quebraria: corte 28 em
  // marco pediria o dia 29 de fevereiro, que em 2026 nao existe.
  const mar = P.janelaDoPeriodo(C28, 3, 2026)
  t('corte 28, 03/2026 comeca em 01/03/2026', mar.inicio === '2026-03-01', mar.inicio)
  t('corte 28, 03/2026 termina em 28/03/2026', mar.fim === '2026-03-28', mar.fim)
  t('corte 28 em marco NAO atravessa mes', mar.atravessaMes === false)
  const marB = P.janelaDoPeriodo(C28, 3, 2028)
  t('corte 28, 03/2028 comeca em 29/02/2028 (bissexto)', marB.inicio === '2028-02-29', marB.inicio)
}

// ---------------------------------------------------------------- 4. contiguidade
console.log('4. periodos consecutivos CONTIGUOS (nenhum dia em dois documentos nem em nenhum)')
for (const reg of [CIVIL, C20, C28, C1]) {
  let contiguos = true, detalhe = ''
  for (let ano = 2025; ano <= 2029; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const atual = P.janelaDoPeriodo(reg, mes, ano)
      const seg = P.competenciaSeguinte(mes, ano)
      if (seg.ano > 2029) continue
      const prox = P.janelaDoPeriodo(reg, seg.mes, seg.ano)
      if (P.somarUmDia(atual.fim) !== prox.inicio) {
        contiguos = false
        detalhe = `${mes}/${ano}: fim ${atual.fim}, proximo inicio ${prox.inicio}`
        break
      }
    }
    if (!contiguos) break
  }
  t(`${reg.nome}: 5 anos de periodos contiguos`, contiguos, detalhe)
}

// ---------------------------------------------------------------- 5. mes civil inalterado
console.log('5. mes civil e EXATAMENTE o mes — a Fase 1 nao pode mudar nada para a rede')
{
  let todosCertos = true, erro = ''
  for (let mes = 1; mes <= 12; mes++) {
    const j = P.janelaDoPeriodo(CIVIL, mes, 2026)
    const ultimo = P.diasNoMes(mes, 2026)
    if (j.inicio !== `2026-${String(mes).padStart(2, '0')}-01`
      || j.fim !== `2026-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
      || j.atravessaMes !== false || j.diaCorte !== null) {
      todosCertos = false; erro = `${mes}/2026 -> ${j.inicio} a ${j.fim}`; break
    }
  }
  t('12 meses de mes civil exatos', todosCertos, erro)
  t('regime nulo cai no mes civil', (() => {
    const j = P.janelaDoPeriodo(null, 9, 2026)
    return j.inicio === '2026-09-01' && j.fim === '2026-09-30'
  })())
  t('mes civil nao vira corte 31', P.janelaDoPeriodo(CIVIL, 2, 2026).fim === '2026-02-28')
}

// ---------------------------------------------- 6. as duas metades (o achado de 16/09/2026)
console.log('6. metadesDoPeriodo — as duas reguas de folha do periodo 21->20')
{
  const j = P.janelaDoPeriodo(C20, 9, 2026)
  const ms = P.metadesDoPeriodo(j)
  t('periodo que atravessa devolve DUAS metades', ms.length === 2, String(ms.length))
  t('1a metade = 08/2026, dias 21..31', ms[0] && ms[0].mes === 8 && ms[0].ano === 2026
    && ms[0].diaInicio === 21 && ms[0].diaFim === 31, JSON.stringify(ms[0]))
  t('2a metade = 09/2026, dias 1..20', ms[1] && ms[1].mes === 9 && ms[1].ano === 2026
    && ms[1].diaInicio === 1 && ms[1].diaFim === 20, JSON.stringify(ms[1]))

  // Sem isso, totaisFolha seria chamada uma vez com mes=9 sobre os 31 dias e aplicaria o
  // liquido (8h) aos dias de agosto, que a folha Revisada computou a 10h: -40h nas 4 apuracoes.
  const diasTotais = ms.reduce((s, m) => s + (m.diaFim - m.diaInicio + 1), 0)
  t('as metades cobrem 31 dias (11 de agosto + 20 de setembro)', diasTotais === 31, String(diasTotais))

  const civil = P.metadesDoPeriodo(P.janelaDoPeriodo(CIVIL, 9, 2026))
  t('mes civil devolve UMA metade', civil.length === 1, String(civil.length))
  t('a metade unica cobre o mes todo', civil[0].diaInicio === 1 && civil[0].diaFim === 30)

  const fev = P.metadesDoPeriodo(P.janelaDoPeriodo(C20, 3, 2026))
  t('1a metade de 03/2026 termina no dia 28 (fevereiro)', fev[0].diaFim === 28, String(fev[0].diaFim))
}

// ---------------------------------------------------------------- 7. diaNoPeriodo
console.log('7. diaNoPeriodo')
{
  const j = P.janelaDoPeriodo(C20, 9, 2026)
  t('20/08 fica FORA', P.diaNoPeriodo(j, 20, 8, 2026) === false)
  t('21/08 entra', P.diaNoPeriodo(j, 21, 8, 2026) === true)
  t('31/08 entra', P.diaNoPeriodo(j, 31, 8, 2026) === true)
  t('01/09 entra', P.diaNoPeriodo(j, 1, 9, 2026) === true)
  t('20/09 entra', P.diaNoPeriodo(j, 20, 9, 2026) === true)
  t('21/09 fica FORA', P.diaNoPeriodo(j, 21, 9, 2026) === false)
}

// ------------------------------------------------- 8. resolucao do regime (os tres niveis)
console.log('8. regimeDoServidor — os tres niveis da resolucao')
{
  const regimes = [CIVIL, C20, C28]
  const SRV = 'srv-1', OUTRO = 'srv-2'

  t('sem vigencia nenhuma cai no PADRAO, nunca em null', (() => {
    const r = P.regimeDoServidor([], regimes, SRV, '2026-09-16')
    return r && r.id === CIVIL.id
  })())

  const global = [{ id: 'v-g', servidor_id: null, regime_id: C20.id, vigencia_inicio: '2026-01-01', vigencia_fim: null }]
  t('vigencia GLOBAL alcanca quem nao tem linha propria', (() => {
    const r = P.regimeDoServidor(global, regimes, SRV, '2026-09-16')
    return r && r.id === C20.id
  })())
  t('a global alcanca qualquer servidor (e assim que o corte volta para a rede)', (() => {
    const r = P.regimeDoServidor(global, regimes, OUTRO, '2026-09-16')
    return r && r.id === C20.id
  })())

  const ambas = [
    ...global,
    { id: 'v-s', servidor_id: SRV, regime_id: C28.id, vigencia_inicio: '2026-06-01', vigencia_fim: null }
  ]
  t('a linha do SERVIDOR vence a global', (() => {
    const r = P.regimeDoServidor(ambas, regimes, SRV, '2026-09-16')
    return r && r.id === C28.id
  })())
  t('quem nao tem linha propria continua na global', (() => {
    const r = P.regimeDoServidor(ambas, regimes, OUTRO, '2026-09-16')
    return r && r.id === C20.id
  })())

  // ⚠️ A vigencia e o que impede a apuracao de agosto de ser reinterpretada quando alguem entra
  // no regime em setembro (a licao da jornada do mes, 19/08/2026).
  const desdeSet = [{ id: 'v-x', servidor_id: SRV, regime_id: C20.id, vigencia_inicio: '2026-09-01', vigencia_fim: null }]
  t('antes do inicio da vigencia, o passado NAO muda', (() => {
    const r = P.regimeDoServidor(desdeSet, regimes, SRV, '2026-08-31')
    return r && r.id === CIVIL.id
  })())
  t('a partir do inicio, vale o novo', (() => {
    const r = P.regimeDoServidor(desdeSet, regimes, SRV, '2026-09-01')
    return r && r.id === C20.id
  })())

  const fechada = [{ id: 'v-f', servidor_id: SRV, regime_id: C20.id, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-06-30' }]
  t('vigencia encerrada nao vale depois do fim', (() => {
    const r = P.regimeDoServidor(fechada, regimes, SRV, '2026-07-01')
    return r && r.id === CIVIL.id
  })())
  t('vigencia encerrada vale no ultimo dia dela', (() => {
    const r = P.regimeDoServidor(fechada, regimes, SRV, '2026-06-30')
    return r && r.id === C20.id
  })())
}

// ------------------------------------------------------- 9. data de referencia e descricao
console.log('9. data de referencia e descricao legivel')
{
  t('referencia de 09/2026 = ultimo dia do mes', P.dataDeReferencia(9, 2026) === '2026-09-30')
  t('referencia de 02/2026 = 28', P.dataDeReferencia(2, 2026) === '2026-02-28')
  const d = P.descreverJanela(P.janelaDoPeriodo(C20, 9, 2026))
  t('descricao nomeia os dois meses', /agosto/.test(d) && /setembro/.test(d), d)
  t('descricao tem os dois dias', /21/.test(d) && /20/.test(d), d)
  t('mes civil tem descricao propria', P.descreverJanela(P.janelaDoPeriodo(CIVIL, 9, 2026)) === P.ROTULO_MES_CIVIL)
}

// ---------------------------------------------------------------- 10. recusas
console.log('10. entrada invalida e recusada, nunca silenciada')
{
  const recusa = fn => { try { fn(); return false } catch { return true } }
  t('mes 0 recusado', recusa(() => P.janelaDoPeriodo(C20, 0, 2026)))
  t('mes 13 recusado', recusa(() => P.janelaDoPeriodo(C20, 13, 2026)))
  t('ano 1999 recusado', recusa(() => P.janelaDoPeriodo(C20, 9, 1999)))
  t('corte 31 recusado (nao existe em fevereiro)', recusa(() => P.janelaDoPeriodo({ dia_corte: 31 }, 9, 2026)))
  t('corte 29 recusado', recusa(() => P.janelaDoPeriodo({ dia_corte: 29 }, 9, 2026)))
  t('corte 0 recusado', recusa(() => P.janelaDoPeriodo({ dia_corte: 0 }, 9, 2026)))
}

// ------------------------- 11. varredura: ninguem deriva a janela fora da fonte unica
console.log('11. varredura — nenhum sitio novo deriva a janela por conta propria')
{
  const raiz = path.join(__dirname, '..', 'src')
  const arquivos = []
  ;(function anda(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) anda(p)
      else if (/\.(ts|tsx)$/.test(e.name)) arquivos.push(p)
    }
  })(raiz)

  const FONTE = path.join('utils', 'folha', 'periodoApuracao.ts')

  /*
    ⚠️ A varredura procura ARITMÉTICA, nunca texto. A primeira versao procurava tambem a string
    "21 a 20" e reprovou as proprias telas desta funcionalidade, cujo TITULO e
    "Apurações do período (21 a 20)". Texto de interface nao deriva janela nenhuma — mencionar o
    corte para o usuario e exatamente o que se quer. O que nao pode e o corte ser CALCULADO fora
    da fonte unica.
  */
  const PADROES = [
    // "dia_corte + 1" / "diaCorte + 1" — a formula que quebra em fevereiro (ver §4.2 do plano).
    /(diaCorte|dia_corte)\s*\+\s*1/,
    // Recorte do periodo escrito a mao: comparacao de `dia` com 20/21 literais.
    /\bdia\s*(?:>=?|<=?|===?)\s*2[01]\b/,
    /\b2[01]\s*(?:>=?|<=?|===?)\s*\w*[Dd]ia\b/,
    // Montagem de janela sem passar pela funcao: `new Date(ano, mes - 1, 21)` e afins.
    /new Date\([^)]*,\s*2[01]\s*\)/,
  ]

  const suspeitos = []
  for (const f of arquivos) {
    if (f.includes(FONTE)) continue
    const txt = fs.readFileSync(f, 'utf8')
    if (PADROES.some(p => p.test(txt))) suspeitos.push(path.relative(raiz, f))
  }
  t('nenhum sitio deriva o corte a mao (aritmetica, nao texto)',
    suspeitos.length === 0, suspeitos.join(', '))
}

// ------------------------- 12. a migration e o TS dizem a mesma coisa
console.log('12. a migration existe e carrega os invariantes')
{
  const mig = path.join(__dirname, '..', 'supabase', 'migrations',
    '20260916110000_regime_de_apuracao_da_folha.sql')
  t('migration da Fase 1 existe', fs.existsSync(mig))
  if (fs.existsSync(mig)) {
    const sql = fs.readFileSync(mig, 'utf8')
    t('o SQL deriva o inicio pelo fim do periodo anterior', /v_fim_ant\s*\+\s*1/.test(sql))
    t('o SQL NAO usa dia_corte + 1 do mes anterior', !/v_corte\s*\+\s*1\s*\)/.test(sql))
    t('CHECK do corte limita a 28', /dia_corte BETWEEN 1 AND 28/.test(sql))
    t('historico e append-only', /trg_historico_regime_append_only/.test(sql))
    t('REVOKE FROM PUBLIC nas funcoes', (sql.match(/REVOKE ALL ON FUNCTION/g) || []).length >= 5)
    t('a conferencia EXECUTA a funcao (armadilha 42)', /FROM public\.fn_periodo_apuracao\(/.test(sql))
    t('a conferencia checa o outro sentido (mes civil por omissao)',
      /deixou de cair no mes civil/.test(sql))
    t('a vigencia global esta documentada', /servidor_id IS NULL/.test(sql))
    t('o achado das duas reguas esta registrado no cabecalho',
      /ATRAVESSA O CORTE DE VIGENCIA/.test(sql))
  }
}

console.log(`\n${falhas === 0 ? 'OK' : 'REPROVADO'}: ${ok} assercoes passaram, ${falhas} falharam.`)
process.exit(falhas === 0 ? 0 : 1)
