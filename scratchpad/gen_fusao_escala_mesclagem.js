/**
 * Gera 20260906100000_mesclagem_funde_escala_do_mesmo_setor.sql a partir da versao VIGENTE das
 * duas funcoes (20260904130000), aplicando substituicoes pontuais e abortando se a contagem de
 * ocorrencias divergir (armadilha 1 do CLAUDE.md: nao redigitar corpo de funcao a mao).
 *
 * O segundo argumento de String.replace nunca e string aqui -- as substituicoes usam split/join,
 * que nao interpreta os padroes de cifrao ($$ do dollar-quoting, $' do regex do plpgsql).
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260904130000_mesclar_cadastros_de_servidor.sql')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260906100000_mesclagem_funde_escala_do_mesmo_setor.sql')

const fonte = fs.readFileSync(FONTE, 'utf8')
const EOL = fonte.includes('\r\n') ? '\r\n' : '\n'
const L = (linhas) => linhas.join(EOL)

function recortar(inicio, fim, rotulo) {
  const i = fonte.indexOf(inicio)
  if (i < 0) throw new Error(rotulo + ': inicio nao encontrado')
  const j = fonte.indexOf(fim, i)
  if (j < 0) throw new Error(rotulo + ': fim nao encontrado')
  return fonte.slice(i, j + fim.length)
}

function trocar(txt, de, para, rotulo, esperado) {
  const n = txt.split(de).length - 1
  const alvo = esperado === undefined ? 1 : esperado
  if (n !== alvo) throw new Error(rotulo + ': esperava ' + alvo + ' ocorrencia(s), achou ' + n)
  return txt.split(de).join(para)
}

// ---------------------------------------------------------------------------
// 1. fn_impedimentos_mesclagem_servidor
// ---------------------------------------------------------------------------
let imped = recortar(
  'DROP FUNCTION IF EXISTS public.fn_impedimentos_mesclagem_servidor(uuid, uuid);',
  'GRANT EXECUTE ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) TO authenticated, service_role;',
  'fn_impedimentos_mesclagem_servidor'
)

imped = trocar(imped,
  L(['    v_qtd     bigint;', '    v_lista   text;']),
  L([
    '    v_qtd      bigint;',
    '    v_lista    text;',
    '    g          record;',
    '    v_conflito text;',
  ]),
  'declare dos impedimentos')

const ancoraVarredura = L([
  '    -- Colisao de unicidade em qualquer tabela que aponte para servidores. A varredura e por',
  '    -- pg_INDEX (e nao pg_constraint) para alcancar tambem indice unico PARCIAL - ver o cabecalho.',
])

const blocoGemeas = L([
  '    -- Escala do mesmo servidor na MESMA competencia, unidade e setor nos dois cadastros. As',
  '    -- duas linhas de escala_mensal nao cabem numa so (unique mes/ano/servidor/unidade/setor), e',
  '    -- ate 05/09/2026 isso caia na varredura generica de unicidade abaixo, travando a mesclagem',
  '    -- inteira -- inclusive quando os dias eram DISJUNTOS e nada disputava nada.',
  '    --',
  '    -- A mesclagem passa a FUNDIR as duas escalas movendo os dias (secao 6.0 de',
  '    -- fn_mesclar_servidores). O que continua recusado e o dia que os dois cadastros disputam:',
  '    -- ficar com um turno e descartar o outro e decisao de quem escala, nunca da ferramenta.',
  '    FOR g IN',
  '        SELECT emo.id AS origem_id, emd.id AS destino_id, emo.mes, emo.ano,',
  '               emo.status AS status_o, emd.status AS status_d,',
  "               COALESCE(public.fn_setor_caminho(emo.setor_id), '(sem setor)') AS setor",
  '          FROM public.escala_mensal emo',
  '          JOIN public.escala_mensal emd',
  '            ON emd.servidor_id = p_destino',
  '           AND emd.mes = emo.mes',
  '           AND emd.ano = emo.ano',
  '           AND emd.unidade_id IS NOT DISTINCT FROM emo.unidade_id',
  '           AND emd.setor_id   IS NOT DISTINCT FROM emo.setor_id',
  '         WHERE emo.servidor_id = p_origem',
  '    LOOP',
  '        -- O dia que existe nos DOIS lados, com a mesma categoria: e ele que nao tem para onde',
  '        -- ir (escala_diaria e unica por escala_mensal_id + dia + categoria). O turno de cada',
  '        -- lado vai na mensagem porque e a informacao que decide o que apagar na grade -- a',
  '        -- recusa anterior nao dizia nem em que dia olhar.',
  "        SELECT string_agg(format('dia %s (%s: %s x %s: %s)',",
  '                                 edo.dia,',
  "                                 v_o.matricula, COALESCE(dto.codigo, '?'),",
  "                                 v_d.matricula, COALESCE(dtd.codigo, '?')),",
  "                          ', ' ORDER BY edo.dia)",
  '          INTO v_conflito',
  '          FROM public.escala_diaria edo',
  '          JOIN public.escala_diaria edd',
  '            ON edd.escala_mensal_id = g.destino_id',
  '           AND edd.dia = edo.dia',
  '           AND edd.categoria = edo.categoria',
  '          LEFT JOIN public.dicionario_turnos dto ON dto.id = edo.dicionario_turnos_id',
  '          LEFT JOIN public.dicionario_turnos dtd ON dtd.id = edd.dicionario_turnos_id',
  '         WHERE edo.escala_mensal_id = g.origem_id;',
  '',
  '        IF v_conflito IS NOT NULL THEN',
  "            motivo := 'escala_em_conflito';",
  '            detalhe := format(',
  "                'Os dois cadastros estao escalados no mesmo dia em %s (%s/%s): %s. '",
  "             || 'Os dois turnos nao cabem na mesma linha da folha - abra a grade, apague na '",
  "             || 'competencia o lancamento que nao aconteceu, e volte aqui.',",
  "                g.setor, lpad(g.mes::text, 2, '0'), g.ano, v_conflito);",
  '            RETURN NEXT;',
  '        END IF;',
  '',
  '        -- Mes fechado nao se funde: mesma regra de fn_validar_destino_escala (20260903120000).',
  '        -- A porta e reabrir a competencia, que ja e ato registrado.',
  '        IF public.fn_competencia_encerrada(g.mes, g.ano) THEN',
  "            motivo := 'competencia_encerrada';",
  '            detalhe := format(',
  "                'A competencia %s/%s esta encerrada e os dois cadastros tem escala em %s. '",
  "             || 'Reabra a competencia em Configuracoes antes de mesclar.',",
  "                lpad(g.mes::text, 2, '0'), g.ano, g.setor);",
  '            RETURN NEXT;',
  '        END IF;',
  '',
  "        IF g.status_o = 'Fechada' OR g.status_d = 'Fechada' THEN",
  "            motivo := 'escala_fechada';",
  '            detalhe := format(',
  "                'A escala de %s/%s em %s esta Fechada em um dos cadastros. Reabra a escala '",
  "             || 'antes de mesclar.', lpad(g.mes::text, 2, '0'), g.ano, g.setor);",
  '            RETURN NEXT;',
  '        END IF;',
  '',
  '        -- A folha aponta para a escala_mensal (unique_escala_mensal_id) e a escala do cadastro',
  '        -- duplicado deixa de existir na fusao. Reapontar a folha esbarraria na folha que o',
  '        -- destino ja tem na mesma competencia (unique_servidor_mes_ano), e juntar dois',
  '        -- documentos de folha nao e mesclagem de cadastro - e outra decisao, com outra tela.',
  '        IF EXISTS (SELECT 1 FROM public.folha_ponto f WHERE f.escala_mensal_id = g.origem_id) THEN',
  "            motivo := 'folha_na_escala_fundida';",
  '            detalhe := format(',
  "                'O cadastro duplicado ja tem folha de ponto de %s/%s em %s, e essa escala '",
  "             || 'precisa ser fundida com a do cadastro que fica. Apague a folha em Rascunho do '",
  "             || 'cadastro duplicado (ela e regerada no cadastro correto) antes de mesclar.',",
  "                lpad(g.mes::text, 2, '0'), g.ano, g.setor);",
  '            RETURN NEXT;',
  '        END IF;',
  '    END LOOP;',
  '',
]) + EOL

imped = trocar(imped, ancoraVarredura, blocoGemeas + ancoraVarredura, 'bloco das gemeas')

imped = trocar(imped,
  L([
    "               AND r.rel NOT IN ('rep_excecoes_ponto', 'public.rep_excecoes_ponto',",
    "                                 'rep_administradores_parque', 'public.rep_administradores_parque',",
    "                                 'rep_cadastros_fila', 'public.rep_cadastros_fila')",
  ]),
  L([
    "               AND r.rel NOT IN ('rep_excecoes_ponto', 'public.rep_excecoes_ponto',",
    "                                 'rep_administradores_parque', 'public.rep_administradores_parque',",
    "                                 'rep_cadastros_fila', 'public.rep_cadastros_fila',",
    '                                 -- escala_mensal tem tratamento proprio no laco acima, que diz',
    '                                 -- QUAL dia esta em disputa. Deixa-la aqui produziria duas',
    '                                 -- linhas para o mesmo problema, uma delas ilegivel.',
    "                                 'escala_mensal', 'public.escala_mensal')",
  ]),
  'escala_mensal fora da varredura generica')

// ---------------------------------------------------------------------------
// 2. fn_mesclar_servidores
// ---------------------------------------------------------------------------
let mesclar = recortar(
  'CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(',
  'GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) TO authenticated, service_role;',
  'fn_mesclar_servidores'
)

mesclar = trocar(mesclar,
  '    v_completados text[] := ARRAY[]::text[];',
  L([
    '    v_completados text[] := ARRAY[]::text[];',
    '    g             record;',
    "    v_fundidas    jsonb := '[]'::jsonb;",
    '    v_dias        bigint;',
  ]),
  'declare da mesclagem')

const ancoraLaco = L([
  '    FOR r IN',
  '        SELECT c.conrelid AS oid,',
])

const blocoFusao = L([
  '    -- 6.0 Escala do mesmo servidor na MESMA competencia/unidade/setor nos dois cadastros: as',
  '    -- duas escala_mensal nao cabem numa so, entao os DIAS mudam de escala e a linha vazia sai.',
  '    -- Roda ANTES do laco generico por necessidade: e ele que faria',
  '    -- UPDATE escala_mensal SET servidor_id, e a unique recusaria a transacao inteira.',
  '    --',
  '    -- Seguro por construcao: fn_impedimentos_mesclagem_servidor ja recusou em bloco quando',
  '    -- algum (dia, categoria) existe nos dois lados, quando a competencia esta encerrada, quando',
  '    -- alguma das escalas esta Fechada e quando ha folha presa a escala que vai sair. Aqui so',
  '    -- chegam dias que nao disputam nada.',
  '    --',
  '    -- A presenca viaja NA PROPRIA LINHA de escala_diaria (ela nao tem servidor_id - herda de',
  '    -- escala_mensal), entao ponto ja batido acompanha o dia sem ser tocado.',
  '    FOR g IN',
  '        SELECT emo.id AS origem_id, emd.id AS destino_id, emo.mes, emo.ano,',
  "               COALESCE(public.fn_setor_caminho(emo.setor_id), '(sem setor)') AS setor",
  '          FROM public.escala_mensal emo',
  '          JOIN public.escala_mensal emd',
  '            ON emd.servidor_id = p_destino',
  '           AND emd.mes = emo.mes',
  '           AND emd.ano = emo.ano',
  '           AND emd.unidade_id IS NOT DISTINCT FROM emo.unidade_id',
  '           AND emd.setor_id   IS NOT DISTINCT FROM emo.setor_id',
  '         WHERE emo.servidor_id = p_origem',
  '    LOOP',
  '        UPDATE public.escala_diaria',
  '           SET escala_mensal_id = g.destino_id',
  '         WHERE escala_mensal_id = g.origem_id;',
  '        GET DIAGNOSTICS v_dias = ROW_COUNT;',
  '',
  '        DELETE FROM public.escala_mensal WHERE id = g.origem_id;',
  '',
  '        v_fundidas := v_fundidas || jsonb_build_object(',
  "            'competencia', lpad(g.mes::text, 2, '0') || '/' || g.ano,",
  "            'setor', g.setor,",
  "            'dias_movidos', v_dias);",
  '    END LOOP;',
  '',
]) + EOL

mesclar = trocar(mesclar, ancoraLaco, blocoFusao + ancoraLaco, 'bloco de fusao')

// O relato aparece duas vezes: uma no log, outra no retorno. As duas precisam citar a fusao --
// escala que mudou de lugar e exatamente o tipo de mudanca que some quando nao e relatada
// (armadilha 22 do CLAUDE.md).
mesclar = trocar(mesclar,
  "        'campos_completados', to_jsonb(v_completados),",
  L([
    "        'campos_completados', to_jsonb(v_completados),",
    "        'escalas_fundidas', v_fundidas,",
  ]),
  'relato', 2)

// ---------------------------------------------------------------------------
const cabecalho = L([
  '-- ============================================================================',
  '-- MESCLAGEM DE CADASTRO: FUNDIR A ESCALA DO MESMO SETOR EM VEZ DE TRAVAR',
  '-- ============================================================================',
  '-- 06/09/2026',
  '--',
  '-- POR QUE',
  '--   fn_mesclar_servidores (20260904130000) move TODO vinculo do cadastro duplicado para o',
  '--   cadastro que fica -- inclusive escala. Mas quando os DOIS cadastros tem escala na mesma',
  '--   competencia, unidade e setor, o UPDATE escala_mensal SET servidor_id do laco generico',
  '--   esbarraria na unique (mes, ano, servidor_id, unidade_id, setor_id); a colisao era detectada',
  '--   antes e a mesclagem recusada por inteiro.',
  '--',
  '--   Medido em producao em 05/09/2026, nos 16 grupos de CPF duplicado: 5 travavam ai. E o',
  '--   travamento nao distinguia dois casos muito diferentes --',
  '--',
  '--     a) as duas escalas cobrem dias DIFERENTES do mesmo mes. Nada disputa nada: e uma escala',
  '--        so, lancada metade sob cada matricula. ELIETE MATOS DIAS (CPF 25896334249) tem 26',
  '--        dias num cadastro e 20 no outro, em 9 e 10/2026, sem UM dia em comum -- e a mesclagem',
  '--        recusava;',
  '--     b) as duas escalas disputam o mesmo dia com turnos diferentes (MT num cadastro, N no',
  '--        outro, categoria Regular -- 4 dos 5 casos). Ai nao ha o que migrar: um dos dois',
  '--        lancamentos nao aconteceu, e escolher qual e decisao de quem escala.',
  '--',
  '--   Esta migration separa os dois: (a) passa a FUNDIR, (b) continua recusando -- agora dizendo',
  '--   setor, competencia, dia e o turno de cada lado, em vez de "escala_mensal: 2 registro(s)',
  '--   ... resolva esses registros antes", que nao dizia nem onde olhar (armadilha 44 do',
  '--   CLAUDE.md: apontar o problema sem dar a saida).',
  '--',
  '-- COMO A FUSAO FUNCIONA',
  '--   escala_diaria NAO tem servidor_id -- herda de escala_mensal (armadilha 47). Entao fundir e',
  '--   repontar escala_diaria.escala_mensal_id para a escala do cadastro que fica e apagar a',
  '--   escala_mensal que ficou vazia. Nada e fabricado e nada e apagado: a presenca ja gravada',
  '--   viaja na propria linha do dia.',
  '--',
  '-- O QUE CONTINUA RECUSADO (e por que nao deve deixar de ser)',
  '--   1. (dia, categoria) presente nos DOIS lados - escala_diaria e unica por (escala_mensal_id,',
  '--      dia, categoria); medido em 05/09/2026 sobre as 35.566 linhas: zero violacoes dessa',
  '--      tripla, e 2.083 pares (escala, dia) com mais de uma linha, sempre de categorias',
  '--      diferentes. Ficar com um turno e descartar o outro seria a ferramenta decidindo escala;',
  '--   2. competencia encerrada ou escala Fechada - mesma regra de fn_validar_destino_escala',
  '--      (20260903120000): a porta e reabrir, que ja e ato registrado;',
  '--   3. folha_ponto presa a escala que vai sair - folha_ponto.escala_mensal_id e unico, e o',
  '--      destino tem (ou tera) a folha dele na mesma competencia (unique_servidor_mes_ano).',
  '--      Juntar dois documentos de folha nao e mesclagem de cadastro.',
  '--',
  '-- POR QUE O CADASTRO DUPLICADO CONTINUA SENDO INATIVADO, E NAO EXCLUIDO',
  '--   A pergunta voltou em 06/09/2026 e a resposta nao mudou: a linha errada carrega uma',
  '--   MATRICULA que ja pode ter sido impressa em folha, escala e relatorio. O dado migra; o',
  '--   NUMERO impresso continua no papel, e sem a linha ele fica sem explicacao possivel. O',
  '--   cadastro perdedor fica Inativo apontando para quem o absorveu (mesclado_em_servidor_id) e',
  '--   ja sai das checagens de CPF desde 20260904140000 - nao atrapalha cadastro novo nem',
  '--   duplicidade futura.',
  '--',
  '-- GERADA POR SCRIPT',
  '--   scratchpad/gen_fusao_escala_mesclagem.js copia as duas funcoes da versao VIGENTE',
  '--   (20260904130000) e aplica substituicoes pontuais, abortando se a contagem divergir. Nao',
  '--   editar este arquivo a mao (armadilha 1 do CLAUDE.md).',
  '--',
  '-- IDEMPOTENTE',
  '--   DROP FUNCTION IF EXISTS antes do CREATE onde o retorno e TABLE (CREATE OR REPLACE nao',
  '--   altera a lista de colunas de saida - 42P13), CREATE OR REPLACE no resto.',
  '-- ============================================================================',
  '',
  '',
  '-- ============================================================================',
  '-- 1. O QUE IMPEDE A MESCLAGEM',
  '-- ============================================================================',
  '-- Copia integral de 20260904130000 MAIS o tratamento proprio da escala do mesmo setor. Os',
  '-- impedimentos que ja existiam TEM que continuar: CPF divergente e o unico dado que diz que os',
  '-- dois cadastros sao a mesma pessoa, e escala_sobreposta e a armadilha 23 aplicada antes de',
  '-- criar o estado que o trigger existe para impedir.',
  '',
])

const meio = L([
  '',
  '',
  '-- ============================================================================',
  '-- 2. A MESCLAGEM',
  '-- ============================================================================',
  '-- Copia integral de 20260904130000 MAIS a secao 6.0 (fusao da escala do mesmo setor).',
  '',
])

const rodape = L([
  '',
  '',
  '-- ============================================================================',
  '-- CONFERENCIA APOS APLICAR',
  '-- ============================================================================',
  '--',
  '--   1) Os grupos que travavam so por escala do mesmo setor passam a nao ter impedimento',
  '--      nenhum. Em 05/09/2026, ELIETE MATOS DIAS (CPF 25896334249) era o unico:',
  '--',
  "--   SELECT * FROM public.fn_impedimentos_mesclagem_servidor(",
  "--       (SELECT id FROM public.servidores WHERE matricula = '67766'),",
  "--       (SELECT id FROM public.servidores WHERE matricula = '1009'));",
  '--   -- esperado: nenhuma linha',
  '--',
  '--   2) ...e os que disputam o mesmo dia continuam recusados, agora nomeando dia e turno de',
  '--      cada lado (esperado: escala_em_conflito, com "dia 1 (68316: MT x 33568: N)"):',
  '--',
  "--   SELECT * FROM public.fn_impedimentos_mesclagem_servidor(",
  "--       (SELECT id FROM public.servidores WHERE matricula = '68316'),",
  "--       (SELECT id FROM public.servidores WHERE matricula = '33568'));",
  '--',
  '--   3) Nenhuma escala_mensal orfa de servidor e nenhuma escala_diaria apontando para',
  '--      escala_mensal inexistente (esperado: 0 e 0):',
  '--',
  '--   SELECT count(*) FROM public.escala_mensal em',
  '--    WHERE NOT EXISTS (SELECT 1 FROM public.servidores s WHERE s.id = em.servidor_id);',
  '--   SELECT count(*) FROM public.escala_diaria ed',
  '--    WHERE NOT EXISTS (SELECT 1 FROM public.escala_mensal em WHERE em.id = ed.escala_mensal_id);',
  '--',
  '--   4) A tripla que a fusao nao pode violar (esperado: nenhuma linha):',
  '--',
  '--   SELECT escala_mensal_id, dia, categoria, count(*)',
  '--     FROM public.escala_diaria GROUP BY 1,2,3 HAVING count(*) > 1;',
  '',
])

const saida = cabecalho + imped + meio + mesclar + rodape

// Conferencia estrutural do arquivo inteiro, na forma de gen_dobra.js: delimitadores de
// dollar-quoting em pares, as duas funcoes uma vez cada, e os GRANT preservados.
const cifroes = (saida.match(/\$fn\$/g) || []).length
if (cifroes !== 4) throw new Error('delimitadores $fn$ fora de par: ' + cifroes)
const conf = [
  ['CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor', 1],
  ['CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores', 1],
  ['REVOKE ALL ON FUNCTION public.fn_impedimentos_mesclagem_servidor', 1],
  ['REVOKE ALL ON FUNCTION public.fn_mesclar_servidores', 1],
  ['GRANT EXECUTE ON FUNCTION public.fn_impedimentos_mesclagem_servidor', 1],
  ['GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores', 1],
  // Os impedimentos que ja existiam continuam la -- copia mecanica que perde um deles e
  // exatamente a regressao da armadilha 1.
  ["motivo := 'cpf_divergente';", 1],
  ["motivo := 'sem_cpf';", 1],
  ["motivo := 'escala_sobreposta';", 1],
  ["motivo := 'origem_ja_mesclada';", 1],
  ["motivo := 'destino_ja_mesclado';", 1],
  ["motivo := 'colisao_unicidade';", 1],
  // ...e os novos entraram.
  ["motivo := 'escala_em_conflito';", 1],
  ["motivo := 'competencia_encerrada';", 1],
  ["motivo := 'escala_fechada';", 1],
  ["motivo := 'folha_na_escala_fundida';", 1],
  // A fusao roda antes do laco generico, e o GUC da imutabilidade da marcacao continua sendo
  // ligado (sem ele, cadastro com batida volta a ser immesclavel).
  ["PERFORM set_config('sisescala.mesclar_servidor', 'on', true);", 1],
  ['DELETE FROM public.escala_mensal WHERE id = g.origem_id;', 1],
  ["'escalas_fundidas', v_fundidas,", 2],
]
for (const [trecho, esperado] of conf) {
  const n = saida.split(trecho).length - 1
  if (n !== esperado) {
    throw new Error('invariante quebrado: "' + trecho + '" aparece ' + n + 'x, esperado ' + esperado)
  }
}

// A fusao PRECISA vir antes do laco que move servidor_id -- se inverter, a unique de
// escala_mensal derruba a transacao e o sintoma seria "mesclagem quebrou para todo mundo".
const posFusao = saida.indexOf('DELETE FROM public.escala_mensal WHERE id = g.origem_id;')
const posLaco = saida.indexOf("EXECUTE format('UPDATE %s SET %I = $2 WHERE %I = $1'")
if (posFusao < 0 || posLaco < 0 || posFusao > posLaco) {
  throw new Error('a fusao de escala precisa vir ANTES do laco generico de UPDATE')
}

fs.writeFileSync(SAIDA, saida)
console.log('gerada:', path.basename(SAIDA), '-', saida.split(EOL).length, 'linhas')
