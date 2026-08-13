// Gera 20260812160000_guard_aceitar_marcacao_pendente.sql copiando o corpo VIGENTE de
// fn_aceitar_marcacao_pendente (20260808100000) e inserindo o bloco de guards.
//
// CLAUDE.md armadilha 1: nao redigitar corpo de funcao a mao. Este script:
//   1. extrai o CREATE OR REPLACE inteiro do arquivo vigente;
//   2. confere invariantes ANTES (o que a versao vigente tem que ter);
//   3. faz DUAS substituicoes pontuais (declaracoes + bloco de guards);
//   4. confere invariantes DEPOIS e aborta em qualquer divergencia;
//   5. confere que, removidos os trechos inseridos, o resto ficou BYTE A BYTE identico.
//
// Arquivos de migration usam CRLF (CLAUDE.md convencoes) - lidos e escritos como texto cru.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const VIGENTE = path.join(RAIZ, 'supabase/migrations/20260808100000_registro_de_ponto_sem_restricao_de_horario.sql')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260812160000_guard_aceitar_marcacao_pendente.sql')

const morrer = (m) => { console.error('ABORTADO: ' + m); process.exit(1) }
const contar = (s, sub) => s.split(sub).length - 1

const fonte = fs.readFileSync(VIGENTE, 'utf8')

// --- 1. extrai a funcao inteira -------------------------------------------------------------
const INICIO = 'CREATE OR REPLACE FUNCTION public.fn_aceitar_marcacao_pendente('
const i = fonte.indexOf(INICIO)
if (i === -1) morrer('nao achei fn_aceitar_marcacao_pendente no arquivo vigente')
const fimMarca = '\r\n$fn$;'
const j = fonte.indexOf(fimMarca, i)
if (j === -1) morrer('nao achei o fechamento $fn$; da funcao')
let corpo = fonte.slice(i, j + fimMarca.length)

// --- 2. invariantes ANTES -------------------------------------------------------------------
const antes = [
  ['SELECT m.ocorrido_em, m.servidor_id INTO v_ocorrido, v_servidor', 1],
  ["RETURN jsonb_build_object('success', false, 'message', 'Marcação não encontrada.');", 1],
  ["PERFORM set_config('sisescala.reconciliacao', 'on', true);", 1],
  ['UPDATE public.escala_diaria', 4],
  ['COALESCE(presenca_entrada_em, v_ocorrido)', 1],
  ['INSERT INTO public.marcacoes_tratamentos', 1],
  ['$fn$', 2],
]
for (const [frag, n] of antes) {
  const c = contar(corpo, frag)
  if (c !== n) morrer(`invariante ANTES divergiu: "${frag.slice(0, 60)}" esperado ${n}, achei ${c}`)
}
// v_servidor e' lido e nunca usado na versao vigente - e' isso que estamos consertando.
if (contar(corpo, 'v_servidor') !== 2) morrer('v_servidor deveria aparecer 2x (declaracao + SELECT) na versao vigente')

// --- 3. substituicoes pontuais ---------------------------------------------------------------
// IMPORTANTE: o 2o argumento de String.replace tem que ser FUNCAO. Com string, o JS interpreta
// $$ e $' e destroi o dollar-quoting do plpgsql (CLAUDE.md, armadilha 1).
const DECL_VELHA = '    v_ocorrido timestamptz;\r\n    v_servidor uuid;\r\n'
if (contar(corpo, DECL_VELHA) !== 1) morrer('bloco DECLARE nao bate com o esperado')
const DECL_NOVA = DECL_VELHA + [
  '    v_timezone      text;',
  '    v_data_batida   date;',
  '    v_esc_servidor  uuid;',
  '    v_esc_categoria text;',
  '    v_esc_mes       integer;',
  '    v_esc_ano       integer;',
  '    v_esc_data      date;',
  '',
].join('\r\n')
corpo = corpo.replace(DECL_VELHA, () => DECL_NOVA)

// O bloco de guards entra DEPOIS de "Marcação não encontrada" (precisa de v_ocorrido/v_servidor)
// e ANTES do set_config/UPDATE - nenhuma escrita pode ter acontecido ainda.
const ANCORA = [
  '    IF v_ocorrido IS NULL THEN',
  "        RETURN jsonb_build_object('success', false, 'message', 'Marcação não encontrada.');",
  '    END IF;',
  '',
].join('\r\n')
if (contar(corpo, ANCORA) !== 1) morrer('ancora do guard nao encontrada exatamente 1x')

const GUARDS = ANCORA + [
  '    -- ========================================================================================',
  '    -- GUARDS DO PAR (MARCACAO, ESCALA) - 20260812160000',
  '    -- ========================================================================================',
  '    -- Ate' + ' aqui esta funcao nao conferia NADA sobre o par que recebe: gravava o horario real',
  '    -- em qualquer linha de escala_diaria cujo id lhe fosse passado. v_servidor era lido acima e',
  '    -- descartado sem uso - a checagem foi pensada e ficou pelo caminho.',
  '    --',
  '    -- Nao e' + ' teorico: buscarEscalasCandidatas derivava o dia da batida no fuso do processo Node',
  '    -- (a VPS roda em UTC), entao batida com hora local >= 21:00 fazia a tela listar as escalas do',
  '    -- dia SEGUINTE, e um clique gravaria o horario real na linha errada - com origem "terminal",',
  '    -- parecendo batida legitima. A tela foi corrigida na v1.60.0; este guard existe porque a RPC',
  '    -- e' + ' GRANTada a authenticated e alcancavel direto, sem passar por tela nenhuma.',
  '    --',
  '    -- Os tres caminhos que chamam esta funcao herdam os guards de uma vez: fn_validar_presenca_manual,',
  '    -- fn_aceitar_tentativa_recusada e a aba Pendencias de /marcacoes (que chama direto).',
  '    SELECT em.servidor_id, ed.categoria::text, em.mes, em.ano,',
  '           make_date(em.ano, em.mes, ed.dia)',
  '      INTO v_esc_servidor, v_esc_categoria, v_esc_mes, v_esc_ano, v_esc_data',
  '      FROM public.escala_diaria ed',
  '      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id',
  '     WHERE ed.id = p_escala_diaria_id;',
  '',
  '    IF v_esc_servidor IS NULL THEN',
  "        RETURN jsonb_build_object('success', false, 'message', 'Linha de escala não encontrada.');",
  '    END IF;',
  '',
  '    -- Nunca ha' + ' caso legitimo de gravar a batida de uma pessoa na escala de outra.',
  '    IF v_esc_servidor <> v_servidor THEN',
  "        RETURN jsonb_build_object('success', false,",
  "            'message', 'A batida é de outro servidor. Não é possível vinculá-la a esta escala.');",
  '    END IF;',
  '',
  '    -- Mesma fonte e mesmo fallback de timezone de fn_confirmar_presenca.',
  "    SELECT (valor#>>'{}')::text INTO v_timezone",
  "      FROM public.configuracoes_globais WHERE chave = 'timezone';",
  "    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;",
  '    v_data_batida := (v_ocorrido AT TIME ZONE v_timezone)::date;',
  '',
  '    -- A escala tem que ser do dia da batida ou do dia ANTERIOR, nunca posterior.',
  '    --',
  '    --   posterior: bloqueado. Medido em producao em 12/08/2026 - dos 27 turnos ancorados o mais',
  '    --   cedo comeca 07:00, e das 17 jornadas a mais cedo e' + ' 07H; nenhuma comeca de madrugada.',
  '    --   Logo uma batida do dia D nunca pode ser a entrada do turno do dia D+1. Essa e' + ' exatamente',
  '    --   a forma que o bug de fuso produzia.',
  '    --',
  '    --   anterior (D-1): PRECISA continuar valendo. As jornadas "18H AS 06H" e "19H AS 07H" cruzam',
  '    --   a meia-noite, entao a batida das 06:05 do dia D e' + ' a saida legitima do turno do dia D-1.',
  '    --   E' + ' o mesmo alcance do "cursor de ontem" de fn_confirmar_presenca.',
  '    IF v_esc_data > v_data_batida OR v_esc_data < (v_data_batida - 1) THEN',
  "        RETURN jsonb_build_object('success', false,",
  "            'message', 'A batida de ' || to_char(v_data_batida, 'DD/MM/YYYY') ||",
  "                       ' não pertence à escala de ' || to_char(v_esc_data, 'DD/MM/YYYY') ||",
  "                       '. Selecione uma escala do próprio dia da batida (ou da véspera, em turno' ||",
  "                       ' que cruza a meia-noite).');",
  '    END IF;',
  '',
  '    -- Sobreaviso nao registra presenca (armadilha 6). A constraint chk_sobreaviso_sem_presenca',
  '    -- ja' + ' rejeitaria a escrita, mas com erro cru - aqui a recusa e' + ' explicada. fn_validar_presenca_manual',
  '    -- ja' + ' checava; quem chama esta funcao direto, nao.',
  "    IF v_esc_categoria = 'Sobreaviso' THEN",
  "        RETURN jsonb_build_object('success', false,",
  "            'message', 'Sobreaviso não registra presença. Use o fluxo de sobreaviso.');",
  '    END IF;',
  '',
  '    -- Idem: so' + ' o wrapper checava competencia encerrada. A aba Pendencias de /marcacoes chama esta',
  '    -- funcao direto e conseguia escrever em mes congelado.',
  '    IF public.fn_competencia_encerrada(v_esc_mes, v_esc_ano) THEN',
  "        RETURN jsonb_build_object('success', false,",
  "            'message', 'Competência ' || lpad(v_esc_mes::text, 2, '0') || '/' || v_esc_ano ||",
  "                       ' está encerrada. Reabra antes de alterar.');",
  '    END IF;',
  '',
].join('\r\n')

corpo = corpo.replace(ANCORA, () => GUARDS)

// --- 4. invariantes DEPOIS -------------------------------------------------------------------
const depois = [
  ['SELECT m.ocorrido_em, m.servidor_id INTO v_ocorrido, v_servidor', 1],
  ['IF v_esc_servidor <> v_servidor THEN', 1],
  ['IF v_esc_data > v_data_batida OR v_esc_data < (v_data_batida - 1) THEN', 1],
  ['public.fn_competencia_encerrada(v_esc_mes, v_esc_ano)', 1],
  ["PERFORM set_config('sisescala.reconciliacao', 'on', true);", 1],
  ['UPDATE public.escala_diaria', 4],
  ['INSERT INTO public.marcacoes_tratamentos', 1],
  ['$fn$', 2],
]
for (const [frag, n] of depois) {
  const c = contar(corpo, frag)
  if (c !== n) morrer(`invariante DEPOIS divergiu: "${frag.slice(0, 60)}" esperado ${n}, achei ${c}`)
}
// Nenhum guard pode ficar DEPOIS da primeira escrita.
const posSetConfig = corpo.indexOf("PERFORM set_config('sisescala.reconciliacao'")
for (const g of ['IF v_esc_servidor <> v_servidor', 'IF v_esc_data >', 'fn_competencia_encerrada']) {
  if (corpo.indexOf(g) > posSetConfig) morrer(`guard "${g}" ficou DEPOIS do set_config - antes de qualquer escrita e' obrigatorio`)
}

// --- 5. o resto ficou byte a byte identico? ---------------------------------------------------
const original = fonte.slice(i, j + fimMarca.length)
const reconstruido = corpo.replace(GUARDS, () => ANCORA).replace(DECL_NOVA, () => DECL_VELHA)
if (reconstruido !== original) morrer('removidos os trechos inseridos, o corpo NAO voltou identico ao vigente')
console.log('OK: fora dos 2 trechos inseridos, o corpo e byte a byte identico ao vigente.')

// --- 6. escreve a migration -------------------------------------------------------------------
const CAB = [
  '-- Migration: guards do par (marcacao, escala) em fn_aceitar_marcacao_pendente',
  '-- Data: 2026-08-12',
  '--',
  '-- ARQUIVO GERADO por scratchpad/gen_guard_aceitar.js. Nao editar a mao - regerar.',
  '-- O corpo e' + ' copia mecanica de 20260808100000 (versao vigente) com DOIS trechos inseridos;',
  '-- o script aborta se qualquer invariante divergir ou se, removidos os trechos, o resto nao',
  '-- voltar byte a byte ao original.',
  '--',
  '-- O QUE ISTO FECHA',
  '--   fn_aceitar_marcacao_pendente grava o horario REAL de uma batida num passo de escala_diaria.',
  '--   Ela recebia p_marcacao_id e p_escala_diaria_id e nao conferia NENHUMA relacao entre os dois:',
  '--   escrevia em qualquer linha cujo id lhe fosse passado. A propria funcao ja lia o servidor da',
  '--   marcacao (v_servidor) e o descartava sem usar.',
  '--',
  '--   O caminho real que expunha isso: buscarEscalasCandidatas (aba Pendencias de /marcacoes)',
  '--   derivava o dia da batida com new Date(iso).getDate(), no fuso do processo Node. A VPS roda',
  '--   em UTC (confirmado desde a v1.2.8), entao batida com hora local >= 21:00 listava as escalas',
  '--   do dia SEGUINTE, e um clique gravaria o horario real na linha errada com origem "terminal" -',
  '--   ou seja, um registro de ponto falso, no dia errado, com aparencia de batida legitima.',
  '--   A tela foi corrigida na v1.60.0. Este guard existe porque a RPC e' + ' GRANTada a authenticated',
  '--   e alcancavel direto por REST, sem passar por tela nenhuma.',
  '--',
  '-- AUDITORIA DO PASSADO (producao, 12/08/2026, somente leitura)',
  '--   27 linhas em marcacoes_tratamentos (11 vincular_escala + 16 desconsiderar).',
  '--   Das 11 com escala vinculada: 0 com dia divergente, 0 com servidor divergente.',
  '--   NENHUM dado foi corrompido. 74 marcacoes pendentes de revisao, so 2 com hora local >= 21:00',
  '--   (12/08, 21:26 e 21:57) - as duas ainda sem tratamento. Das 58.154 marcacoes da base, 86',
  '--   (0,1%) caem na faixa >= 21:00. A exposicao era pequena porque as unidades em operacao hoje',
  '--   nao tem escala noturna - nao porque a funcao se defendesse.',
  '--',
  '-- OS QUATRO GUARDS, E POR QUE CADA UM',
  '--   1. servidor da escala = servidor da marcacao. Nao existe caso legitimo do contrario.',
  '--   2. data da escala entre (dia local da batida - 1) e o dia local da batida.',
  '--      Posterior e' + ' bloqueado: medido em producao, dos 27 turnos ancorados o mais cedo comeca',
  '--      07:00 e das 17 jornadas a mais cedo e' + ' 07H - nenhuma comeca de madrugada, entao batida',
  '--      do dia D nunca e' + ' entrada do turno de D+1. E' + ' exatamente a forma que o bug produzia.',
  '--      Anterior (D-1) CONTINUA valendo: "18H AS 06H" e "19H AS 07H" cruzam a meia-noite, e a',
  '--      batida das 06:05 do dia D e' + ' a saida legitima do turno de D-1. Mesmo alcance do',
  '--      "cursor de ontem" de fn_confirmar_presenca.',
  '--   3. categoria <> Sobreaviso (armadilha 6). A constraint ja barrava, com erro cru.',
  '--   4. competencia nao encerrada. Os itens 3 e 4 so' + ' existiam em fn_validar_presenca_manual;',
  '--      a aba Pendencias de /marcacoes chama esta funcao DIRETO e escapava dos dois - dava para',
  '--      gravar presenca em mes congelado.',
  '--',
  '-- O QUE ESTE GUARD DELIBERADAMENTE NAO FAZ',
  '--   Nao checa se a batida cai dentro da janela prevista do turno. Pendencia e' + ', por definicao,',
  '--   batida FORA da janela - um guard de plausibilidade rejeitaria justamente o caso de uso.',
  '--   Decidir a que passo uma batida distante pertence e' + ' juizo do coordenador (Art. 82, paragrafo',
  '--   unico). O guard barra o impossivel, nunca o incomum.',
  '--',
  '-- NENHUMA OUTRA FUNCAO E' + ' ALTERADA. fn_validar_presenca_manual e fn_aceitar_tentativa_recusada',
  '-- herdam os guards por delegarem a esta - mesmo padrao de fn_confirmar_presenca_manual_bulk.',
  '--',
  '-- CONFERENCIA APOS APLICAR',
  '--   -- 1. par valido continua funcionando (use um id real de pendencia + a escala do dia dela).',
  '--   --    Esperado: success = true.',
  '--',
  '--   -- 2. dia posterior tem que ser recusado SEM escrever nada:',
  '--   SELECT public.fn_aceitar_marcacao_pendente(',
  "--       '<marcacao de 21:xx do dia D>'::uuid,",
  "--       '<escala_diaria do dia D+1 do MESMO servidor>'::uuid,",
  "--       'entrada', '<validador>'::uuid, 'teste de guard');",
  '--   -- esperado: success=false, mensagem citando as duas datas.',
  '--   -- confira em seguida que a escala de D+1 continua com presenca_entrada_em NULL.',
  '--',
  '--   -- 3. servidor trocado tem que ser recusado:',
  '--   --    mesma chamada com escala_diaria de OUTRO servidor -> success=false.',
  '--',
  '--   -- 4. nada foi gravado por engano durante os testes:',
  '--   SELECT count(*) FROM public.marcacoes_tratamentos',
  "--    WHERE justificativa = 'teste de guard';  -- esperado: 0",
  '',
  '',
].join('\r\n')

const ROD = [
  '',
  '',
  "COMMENT ON FUNCTION public.fn_aceitar_marcacao_pendente(uuid, uuid, text, uuid, text) IS",
  "'Grava o horario REAL de uma batida pendente no passo escolhido pelo coordenador.",
  '',
  'Desde 20260812160000 confere o par (marcacao, escala) antes de qualquer escrita: mesmo servidor,',
  'escala do dia da batida ou da vespera (nunca posterior), categoria diferente de Sobreaviso e',
  'competencia aberta. Antes disso escrevia em qualquer escala_diaria cujo id lhe fosse passado.',
  '',
  'Nao valida se a batida cai na janela prevista: pendencia e' + ', por definicao, batida fora da janela.',
  'A que passo ela pertence e' + ' juizo do coordenador (Art. 82, paragrafo unico da Portaria 671/2021).',
  '',
  "Ver docs/evolucao/2026-08-12-previsto-no-modal-de-tratar-marcacao.md.';",
  '',
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_aceitar_marcacao_pendente(uuid, uuid, text, uuid, text)',
  '    TO authenticated, service_role;',
  '',
].join('\r\n')

const saida = CAB + corpo + ROD

// Conferencia estrutural do arquivo inteiro (licao do gen_dobra.js).
if (contar(saida, '$fn$') !== 2) morrer(`delimitadores $fn$ desemparelhados: ${contar(saida, '$fn$')}`)
if (contar(saida, 'CREATE OR REPLACE FUNCTION') !== 1) morrer('CREATE OR REPLACE fora da contagem')
if (contar(saida, 'GRANT EXECUTE') !== 1) morrer('GRANT fora da contagem')
if (saida.indexOf('GRANT EXECUTE') < saida.lastIndexOf('$fn$')) morrer('GRANT caiu dentro da funcao')
if (/\r\n/.test(saida) === false) morrer('arquivo sem CRLF')

fs.writeFileSync(SAIDA, saida)
console.log('escrito:', path.relative(RAIZ, SAIDA), `(${saida.length} bytes)`)
