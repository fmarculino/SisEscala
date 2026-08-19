/**
 * Gera a migration que limita o teto de casamento de marcacao em fn_alocar_marcacoes_dia.
 *
 * POR QUE POR SCRIPT (armadilha 1 do CLAUDE.md)
 *   A funcao e recriada inteira por CREATE OR REPLACE. Redigitar o corpo a mao ja apagou logica
 *   critica seis vezes neste projeto. Aqui o corpo vigente e COPIADO byte a byte do arquivo que
 *   o define hoje, e so as linhas alvo sao trocadas — com contagem de ocorrencias conferida.
 *
 * O QUE MUDA
 *   Uma linha de declaracao (constante nova) e uma linha de atribuicao:
 *     v_tol_ontem := 1440;   ->   v_tol_ontem := LEAST(1440, c_teto_alocacao_min);
 *
 * POR QUE 720
 *   v_tol_ontem tem dois papeis: a janela de busca (quais marcacoes sao candidatas) e, na linha
 *   `IF v_dist <= v_tol_ontem`, o teto de distancia para CASAR uma batida com um slot.
 *   A escala se repete a cada 1440 min. Um teto >= 720 (metade do periodo) torna a batida do dia
 *   vizinho tao proxima do slot quanto a do dia certo, e o casamento por menor distancia passa a
 *   escolher errado. Medido em producao em 19/08/2026: com 1440, 56 de 56 linhas de servidor com
 *   ignora_janela_presenca ficaram com a entrada vinda da vespera (~18:00, a 840 min do slot das
 *   08:00) e a saida vinda do dia seguinte (~08:00, a 840 min do slot das 18:00). Com 720, 840 > 720
 *   e as duas passam a ser recusadas, virando pendencia — que e o desfecho correto.
 *
 *   720 preserva a intencao da flag: para uma escala 08:00-18:00, o slot de entrada ainda aceita
 *   qualquer batida entre 20:00 da vespera e 20:00 do dia, e o de saida entre 06:00 do dia e 06:00
 *   do seguinte. Chefia sem horario fixo continua coberta; o que some e so o alcance ao dia vizinho.
 */

const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const ORIGEM = '20260818090000_enhance_allocation_and_pending_reviews.sql'
const DESTINO = '20260819120000_cap_allocation_match_distance.sql'

const bruto = fs.readFileSync(path.join(DIR, ORIGEM), 'utf8')

// ---- 1. Extrair APENAS fn_alocar_marcacoes_dia do arquivo vigente -----------------
const INI = 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia('
const iIni = bruto.indexOf(INI)
if (iIni < 0) {
  console.error('ABORTADO: nao achei fn_alocar_marcacoes_dia em ' + ORIGEM)
  process.exit(1)
}
const FIM = '$fnaloc$;'
const iFim = bruto.indexOf(FIM, iIni)
if (iFim < 0) {
  console.error('ABORTADO: nao achei o delimitador de fim $fnaloc$;')
  process.exit(1)
}
let corpo = bruto.slice(iIni, iFim + FIM.length)

// ---- 2. Invariantes ANTES da substituicao ----------------------------------------
const conta = (txt, agulha) => txt.split(agulha).length - 1

const esperadoAntes = {
  'v_tol_ontem     integer;': 1,
  'v_tol_ontem := 1440;': 1,
  'IF v_dist <= v_tol_ontem': 1,
  '$fnaloc$': 2,
  'CREATE OR REPLACE FUNCTION': 1,
}
for (const [agulha, n] of Object.entries(esperadoAntes)) {
  const achou = conta(corpo, agulha)
  if (achou !== n) {
    console.error(`ABORTADO: esperava ${n}x "${agulha}" no corpo vigente, achei ${achou}.`)
    process.exit(1)
  }
}

// ---- 3. Substituicoes pontuais (funcao como 2o argumento: cifrao e literal) -------
// A declaracao da constante entra junto da declaracao de v_tol_ontem.
const DECL_DE = '    v_tol_ontem     integer;'
const DECL_PARA = [
  '    v_tol_ontem     integer;',
  '    -- Teto do casamento batida<->slot. A escala repete a cada 1440 min; um teto >= metade',
  '    -- disso faz a batida do dia vizinho empatar com a do dia certo e o casamento por menor',
  '    -- distancia escolhe errado. Ver 20260819120000 e scratchpad/gen_teto_alocacao.js.',
  '    c_teto_alocacao_min constant integer := 720;',
].join('\r\n')

const ATRIB_DE = '        v_tol_ontem := 1440;'
const ATRIB_PARA = '        v_tol_ontem := LEAST(1440, c_teto_alocacao_min);'

let trocas = 0
corpo = corpo.replace(DECL_DE, () => { trocas++; return DECL_PARA })
corpo = corpo.replace(ATRIB_DE, () => { trocas++; return ATRIB_PARA })
if (trocas !== 2) {
  console.error(`ABORTADO: esperava 2 substituicoes, fiz ${trocas}.`)
  process.exit(1)
}

// ---- 4. Invariantes DEPOIS --------------------------------------------------------
const esperadoDepois = {
  'c_teto_alocacao_min constant integer := 720;': 1,
  'v_tol_ontem := LEAST(1440, c_teto_alocacao_min);': 1,
  'v_tol_ontem := 1440;': 0,
  // guards e logica que NAO podem ter sumido na copia (contagens conferidas contra o
  // corpo vigente antes de fixar aqui — nao chutar, senao a trava vira ruido)
  'IF v_dist <= v_tol_ontem': 1,
  'fn_precedencia_origem': 2,
  "'fora_da_janela'": 2,
  "'sem_escala'": 1,
  "'duplicada'": 1,
  'fn_blocos_previstos_dia': 1,
  'rep_tolerancia_alocacao_minutos': 1,
  'SECURITY DEFINER': 1,
  'SET search_path = public': 1,
  '$fnaloc$': 2,
}
for (const [agulha, n] of Object.entries(esperadoDepois)) {
  const achou = conta(corpo, agulha)
  if (achou !== n) {
    console.error(`ABORTADO (pos-troca): esperava ${n}x "${agulha}", achei ${achou}.`)
    process.exit(1)
  }
}

// ---- 5. Montar a migration --------------------------------------------------------
const cabecalho = [
  '-- ============================================================================',
  '-- Migration: limitar o teto de casamento batida<->slot em fn_alocar_marcacoes_dia',
  '-- Data: 2026-08-19',
  '--',
  '-- PROBLEMA',
  '--   A 20260818090000 deu tolerancia de 1440 min (24h) a servidores com',
  '--   ignora_janela_presenca = true. v_tol_ontem tem dois papeis: a janela de busca de',
  '--   candidatas e, em "IF v_dist <= v_tol_ontem", o teto de distancia para CASAR uma',
  '--   batida com um slot. A escala se repete a cada 1440 min, entao um teto de 1440',
  '--   torna a batida do dia vizinho tao proxima do slot quanto a do dia certo.',
  '--',
  '-- EFEITO MEDIDO EM PRODUCAO (19/08/2026, competencia 08/2026)',
  '--   56 linhas de escala_diaria ficaram com a entrada vinda da VESPERA (~18:00, a 840 min',
  '--   do slot de entrada das 08:00) e a saida vinda do DIA SEGUINTE (~08:00, a 840 min do',
  '--   slot de saida das 18:00). 56 de 56 (100%) eram de servidor com a flag ligada.',
  '--   fn_blocos_previstos_dia devolvia a janela CERTA (08:00 -> 18:00 no mesmo dia): o erro',
  '--   estava so na alocacao. Na folha isso aparecia como "entrada 18:00 / saida 08:03", ou',
  '--   seja, um plantao noturno plausivel — silencioso.',
  '--',
  '-- CORRECAO',
  '--   Teto de 720 min (metade do periodo da escala). 840 > 720, entao a batida do dia',
  '--   vizinho passa a ser recusada e vira pendencia, que e o desfecho correto.',
  '--   A intencao da flag e preservada: numa escala 08:00-18:00 o slot de entrada ainda',
  '--   aceita batida de 20:00 da vespera ate 20:00 do dia.',
  '--',
  '-- POR QUE 720 E NAO UM VALOR MENOR (simulado sobre os dados reais de 08/2026,',
  '-- scratchpad/simula_teto_alocacao.js, que reproduz este DP passo a passo)',
  '--',
  '--     teto | corrige | restam | slots casados | quebra dia saudavel',
  '--     -----|---------|--------|---------------|--------------------',
  '--     1440 |       - |     56 |           494 |  (estado atual)',
  '--      840 |      39 |     15 |             - |          0',
  '--      720 |      51 |      3 |           371 |          0',
  '--      600 |      53 |      1 |           364 |          0',
  '--      480 |      54 |      0 |           362 |          0',
  '--      360 |      54 |      0 |           362 |          0',
  '--',
  '--   Nenhum valor quebra dia saudavel. Mas 480 e 360 dao resultado IDENTICO, ou seja',
  '--   abaixo de 480 a flag ignora_janela_presenca vira no-op e deixa de ter proposito.',
  '--   720 e o unico valor com justificativa independente destes dados (metade do periodo:',
  '--   acima dele a batida do dia vizinho empata com a do dia certo) e o unico que mantem a',
  '--   flag fazendo alguma coisa. Os 3 dias que sobram ficam entre 21h e 23h — anomalia',
  '--   visivel para o coordenador, nao corrupcao silenciosa. Apertar mais exige evidencia',
  '--   nova; a tabela acima existe para que isso seja decidido com dado, nao por gosto.',
  '--',
  '-- NAO CORRIGE O DADO JA GRAVADO. As 56 linhas so se ajustam rodando a reconciliacao',
  '--   (fn_reconciliar_marcacoes_dia) depois desta migration, e isso e passo separado e',
  '--   deliberado — mexe em ponto ja projetado.',
  '--',
  '-- Corpo copiado mecanicamente de ' + ORIGEM,
  '-- por scratchpad/gen_teto_alocacao.js, que aborta se a contagem de ocorrencias divergir.',
  '-- ============================================================================',
  '',
  '',
].join('\r\n')

const rodape = [
  '',
  '',
  'COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS',
  "    'Aloca marcacoes do dia nos passos previstos. O teto de casamento batida<->slot e limitado a 720 min (metade do periodo da escala) mesmo para servidores com ignora_janela_presenca, para que uma batida do dia vizinho nunca seja casada com o slot de hoje. Ver 20260819120000.';",
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer)',
  '    TO authenticated, service_role;',
  '',
].join('\r\n')

// Migrations do projeto usam CRLF.
const saida = (cabecalho + corpo + rodape).replace(/\r?\n/g, '\r\n')

// ---- 6. Conferencia estrutural do arquivo inteiro ---------------------------------
const estrutura = {
  '$fnaloc$': 2,
  'CREATE OR REPLACE FUNCTION': 1,
  'GRANT EXECUTE ON FUNCTION': 1,
  'COMMENT ON FUNCTION': 1,
}
for (const [agulha, n] of Object.entries(estrutura)) {
  const achou = conta(saida, agulha)
  if (achou !== n) {
    console.error(`ABORTADO (estrutura do arquivo): esperava ${n}x "${agulha}", achei ${achou}.`)
    process.exit(1)
  }
}
// Convencao do projeto: comentario de migration sem acento. A checagem vale so para o texto
// que ESTE script escreve — o corpo copiado fica intocado, acentos inclusive, porque corrigi-los
// seria editar a logica copiada e e exatamente isso que a copia mecanica existe para impedir.
const meuTexto = [cabecalho, rodape, DECL_PARA, ATRIB_PARA].join('\n')
const acentuadas = meuTexto.split('\n').filter(l => /[À-ɏ]/.test(l))
if (acentuadas.length) {
  console.error('ABORTADO: acento em linha escrita por este script: ' + acentuadas[0].trim())
  process.exit(1)
}

fs.writeFileSync(path.join(DIR, DESTINO), saida)
console.log('OK: ' + DESTINO + ' gerado (' + saida.length + ' bytes).')
console.log('Confira com: git diff --no-index migration_origem_extraida.sql ' + DESTINO)
