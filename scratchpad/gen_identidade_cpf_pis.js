// Gera 20260817170000_resolver_identidade_rep_cpf_ou_pis.sql
//
// Cópia MECÂNICA (CLAUDE.md armadilha 1) do corpo vigente de:
//   - fn_registrar_snapshot_usuarios_dispositivo  (20260813000000_dedup_snapshot_...)
//   - fn_cobertura_ponto_dispositivo              (20260813140000_multi_setor_...)
// com substituições pontuais. Aborta se qualquer contagem de ocorrência divergir.
//
// ⚠️ O segundo argumento de String.replace é SEMPRE função aqui — com string, o JS interpreta
// $$ e $' e destrói o dollar-quoting do plpgsql (CLAUDE.md, gen_dobra.js).

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')
const SAIDA = path.join(MIG, '20260817170000_resolver_identidade_rep_cpf_ou_pis.sql')

function ler(arquivo) {
  return fs.readFileSync(path.join(MIG, arquivo), 'utf8').replace(/\r\n/g, '\n')
}

// Extrai de "CREATE OR REPLACE FUNCTION public.<nome>" até o "$fn$;" que fecha o corpo.
function extrairFuncao(texto, nome) {
  const inicio = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}`)
  if (inicio < 0) throw new Error(`ABORTA: nao achei CREATE de ${nome}`)
  const fim = texto.indexOf('\n$fn$;', inicio)
  if (fim < 0) throw new Error(`ABORTA: nao achei fim do corpo de ${nome}`)
  return texto.slice(inicio, fim + '\n$fn$;'.length)
}

function trocar(texto, de, para, ondeDescricao) {
  const partes = texto.split(de)
  if (partes.length !== 2) {
    throw new Error(
      `ABORTA: "${ondeDescricao}" apareceu ${partes.length - 1}x (esperado exatamente 1). ` +
        `O corpo vigente mudou — reveja o gerador antes de confiar nele.`
    )
  }
  return partes[0] + para + partes[1]
}

// ============================================================================
// 1. fn_registrar_snapshot_usuarios_dispositivo
// ============================================================================
let snapshot = extrairFuncao(ler('20260813000000_dedup_snapshot_usuarios_dispositivo.sql'),
  'fn_registrar_snapshot_usuarios_dispositivo')

const RESOLVIDO_ANTIGO = `    resolvido AS (
        SELECT e.*,
               COALESCE(vinc.servidor_id, cpf_match.id)             AS servidor_id,
               CASE WHEN vinc.servidor_id IS NOT NULL THEN 'vinculo'
                    WHEN cpf_match.id IS NOT NULL THEN 'cpf'
                    ELSE NULL END                                   AS origem_match
          FROM entrada e
          LEFT JOIN public.rep_vinculos_servidor vinc
            ON vinc.dispositivo_id = p_dispositivo_id
           AND vinc.identificador_afd = e.identificador_afd
           AND vinc.vigente_ate IS NULL
          LEFT JOIN public.servidores cpf_match
            ON cpf_match.status = 'Ativo'
           AND right(regexp_replace(COALESCE(cpf_match.cpf, ''), '\\D', '', 'g'), 11)
               = right(e.identificador_afd, 11)
           AND length(regexp_replace(COALESCE(cpf_match.cpf, ''), '\\D', '', 'g')) >= 11
    ),`

const RESOLVIDO_NOVO = `    resolvido AS (
        -- FONTE UNICA de identidade: fn_servidor_por_identificador_afd tenta vinculo, CPF e PIS,
        -- nesta ordem, e RECUSA quando CPF e PIS apontam para pessoas diferentes. Antes daqui
        -- havia um LEFT JOIN casando SO por CPF - foi isso que fez o relogio da SMS (cadastrado
        -- por PIS pelo sistema anterior) resolver ZERO dos 323 usuarios.
        --
        -- LATERAL em vez de LEFT JOIN tambem elimina um risco latente: dois servidores Ativos com
        -- o mesmo CPF multiplicavam a linha e estouravam uq_usuario_dispositivo no INSERT, dando
        -- rollback no snapshot inteiro (o mesmo modo de falha que esta migration de origem
        -- corrigiu para identificador duplicado, pela outra ponta).
        SELECT e.*, r.servidor_id, r.origem_match
          FROM entrada e
          LEFT JOIN LATERAL public.fn_servidor_por_identificador_afd(
                       p_dispositivo_id, e.identificador_afd) r ON true
    ),`

snapshot = trocar(snapshot, RESOLVIDO_ANTIGO, RESOLVIDO_NOVO, 'CTE resolvido do snapshot')

// ============================================================================
// 2. fn_cobertura_ponto_dispositivo
// ============================================================================
let cobertura = extrairFuncao(ler('20260813140000_multi_setor_dispositivos_rep.sql'),
  'fn_cobertura_ponto_dispositivo')

const JOIN_ANTIGO = `          LEFT JOIN public.rep_usuarios_dispositivo u
                 ON u.dispositivo_id = p_dispositivo_id
                AND b.cpf_digitos IS NOT NULL
                AND u.identificador_afd = lpad(b.cpf_digitos, 12, '0')`

const JOIN_NOVO = `          -- Casa pelo servidor JA RESOLVIDO no snapshot, nao por lpad(cpf,12,'0') recalculado
          -- aqui. Recalcular era duplicar a regra de identidade: num relogio cadastrado por PIS
          -- (SMS, 17/08/2026) isso reportava 27 pessoas que batem ponto todo dia como
          -- 'fora_do_relogio'. A resolucao CPF-ou-PIS vive num lugar so, no snapshot.
          --
          -- LATERAL com LIMIT 1: a MESMA pessoa pode ter DOIS cadastros no equipamento (legado
          -- por PIS + cadastro novo por CPF, que e exatamente o cenario da SMS daqui pra frente).
          -- Com LEFT JOIN simples ela apareceria duas vezes na tela.
          LEFT JOIN LATERAL (
              SELECT u2.identificador_afd, u2.nome_no_device, u2.tem_biometria
                FROM public.rep_usuarios_dispositivo u2
               WHERE u2.dispositivo_id = p_dispositivo_id
                 AND u2.servidor_id = b.id
               ORDER BY u2.tem_biometria DESC, u2.identificador_afd
               LIMIT 1
          ) u ON true`

cobertura = trocar(cobertura, JOIN_ANTIGO, JOIN_NOVO, 'LEFT JOIN do snapshot na cobertura')

const CASE_ANTIGO = `           CASE
               WHEN r.cpf_digitos IS NULL                                          THEN 'sem_cpf'`

const CASE_NOVO = `           CASE
               -- ORDEM IMPORTA. Estar no equipamento vem ANTES de "sem_cpf": quem ja esta
               -- cadastrado no relogio (por PIS, por exemplo) nao precisa de CPF para ser
               -- vinculado, e rotular de sem_cpf esconderia alguem que bate ponto todo dia.
               -- sem_cpf passa a significar o que sempre deveria: nao esta no relogio E nao ha
               -- como cadastrar, porque falta o CPF que o cadastro novo usa.`

cobertura = trocar(cobertura, CASE_ANTIGO, CASE_NOVO, 'abertura do CASE de situacao')

const FORA_ANTIGO = `               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL              THEN 'fora_do_relogio'`
const FORA_NOVO = `               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL
                    AND r.cpf_digitos IS NULL                                      THEN 'sem_cpf'
               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL              THEN 'fora_do_relogio'`

cobertura = trocar(cobertura, FORA_ANTIGO, FORA_NOVO, 'ramo fora_do_relogio do CASE')

const COMENTARIO_ANTIGO = `               -- identificador_afd E o CPF preenchido a 12 posicoes (CLAUDE.md armadilha 10).
               -- CPF vazio nao vira identificador nenhum: NULL para nao casar com lpad('',12).`
const COMENTARIO_NOVO = `               -- cpf_digitos NAO e mais usado para casar com o relogio (quem casa e o
               -- servidor_id ja resolvido no snapshot). Sobra so para responder "da para
               -- cadastrar esta pessoa?", porque o cadastro novo usa CPF.`

cobertura = trocar(cobertura, COMENTARIO_ANTIGO, COMENTARIO_NOVO, 'comentario do cpf_digitos')

// ============================================================================
// 3. Invariantes do resultado
// ============================================================================
function conferir(nome, texto, esperados) {
  for (const [padrao, qtd] of esperados) {
    const achados = texto.split(padrao).length - 1
    if (achados !== qtd) {
      throw new Error(`ABORTA: em ${nome}, "${padrao}" aparece ${achados}x (esperado ${qtd}).`)
    }
  }
}

// A cobertura NAO pode ter perdido nenhum rotulo de situacao nem o guard de Sobreaviso.
conferir('fn_cobertura_ponto_dispositivo', cobertura, [
  // Ancorado em "THEN '<rotulo>'", nao no rotulo solto: mencao em COMENTARIO nao pode fazer o
  // portao passar nem falhar. O portao me pegou supondo contagem duas vezes antes disso - a
  // assercao certa e sobre os ramos do CASE, que e o que quebraria a tela se se perdesse.
  [`THEN 'sem_cpf'`, 1],
  [`THEN 'sem_snapshot'`, 1],
  [`THEN 'fora_do_relogio'`, 1],
  [`THEN 'sem_biometria'`, 1],
  [`THEN 'sem_vinculo'`, 1],
  [`ELSE 'ok'`, 1],
  [`<> 'Sobreaviso'`, 1],      // guard da armadilha 6 continua presente
  ['lpad(b.cpf_digitos', 1],   // era 2; sai do JOIN e sobra so no SELECT do ident
])

conferir('fn_registrar_snapshot_usuarios_dispositivo', snapshot, [
  ['DISTINCT ON (identificador_afd)', 1],  // o dedup que a migration de origem criou continua
  // A CHAMADA, nao o nome solto (que tambem aparece no comentario acima dela).
  ['LATERAL public.fn_servidor_por_identificador_afd(', 1],
  ['cpf_match', 0],                        // o join antigo tem que ter saido inteiro
])

// ============================================================================
// 4. Monta o arquivo
// ============================================================================
const CABECALHO = `-- ============================================================================
-- Identidade do relogio: casar por CPF **ou** PIS (17/08/2026)
-- ============================================================================
-- ARQUIVO GERADO por scratchpad/gen_identidade_cpf_pis.js. Nao editar a mao - regerar.
-- fn_registrar_snapshot_usuarios_dispositivo e fn_cobertura_ponto_dispositivo sao copia
-- mecanica do corpo vigente com substituicoes pontuais; o script aborta se qualquer invariante
-- divergir (CLAUDE.md armadilha 1).
--
-- O PROBLEMA (medido em producao em 17/08/2026)
--
--   "O identificador do AFD e o CPF" nunca foi propriedade do AFD - e propriedade de COMO cada
--   pessoa foi cadastrada em CADA relogio. O REP da SMS (10.110.0.20) veio de outro sistema que
--   cadastrava por PIS/NIS: dos 323 usuarios dele, 292 validam como PIS e so 13 como CPF
--   (conferido pelos digitos verificadores). Resultado, tudo silencioso:
--
--     * fn_registrar_snapshot_... resolveu 0 dos 323 (casava so por CPF)
--     * fn_cobertura_ponto_dispositivo rotulou 'fora_do_relogio' 27 servidores que estao no
--       equipamento COM biometria e batem ponto todo dia - a batida virava orfa e a tela dizia
--       que eles nem estavam cadastrados
--     * as 265.922 marcacoes do dispositivo ficaram todas sem dono
--
--   E os relogios da LACEM, CEI e Reg/TI/TFD estao cadastrados por CPF e funcionam. A solucao
--   nao pode quebrar esses.
--
-- A SOLUCAO: uma FONTE UNICA de resolucao que tenta vinculo, CPF e PIS - e nao um flag por
-- dispositivo. Flag por dispositivo seria errado desde o primeiro dia, porque a SMS vai ficar
-- MISTURADA: 292 pessoas antigas por PIS mais todas as novas por CPF, no mesmo equipamento.
-- Misturado e o caso normal, nao a excecao.
--
-- SEGURANCA CONFERIDA EM PRODUCAO ANTES DE ESCREVER ISTO (o "um nao pode atrapalhar o outro"):
--
--   * numeros que sao CPF de um servidor E PIS de outro:            0
--   * usuarios de relogio que casariam com 2 servidores diferentes: 0 (nos 4 dispositivos)
--   * CEI 67/67, LACEM 43/43, Reg-TI-TFD 43/44 casam so por CPF; SMS 48 casam so por PIS
--
--   Os conjuntos sao disjuntos: ampliar para PIS nao pode mudar nenhum casamento existente.
--   Ainda assim fn_servidor_por_identificador_afd RECUSA (devolve NULL) se um dia CPF e PIS
--   apontarem para pessoas diferentes - chutar ali daria ponto de uma pessoa para outra.
--
-- O QUE NAO MUDA
--   * Cadastro NOVO continua usando CPF (fn_enfileirar_cadastros_rep intocada). PIS entra so
--     como chave de LEITURA, para reconhecer o legado.
--   * fn_vincular_cadastros_por_cpf nao muda de corpo: ela sempre leu u.servidor_id do snapshot,
--     nunca casou por CPF - o nome e que engana. Corrigido o COMMENT dela aqui.
--   * RETURNS TABLE de fn_cobertura_ponto_dispositivo intocado, entao CREATE OR REPLACE basta e
--     fn_cobertura_ponto_resumo (envelope LATERAL) nao precisa ser derrubada (armadilha do 42P13).
--   * Nenhuma marcacao e reatribuida por esta migration. Criar vinculo nao reprocessa AFD; quem
--     reprocessa e fn_reparse_afd_dispositivo, e ela le o vinculo VIGENTE NA DATA DA BATIDA.
--     ⚠️ Este dispositivo tem marcacao desde ABRIL/2021 (sistema anterior). Ao vincular, use
--     p_vigente_de na data em que o SisEscala assumiu o ponto da unidade - nunca a primeira
--     batida do AFD, ou cinco anos de ponto alheio entram na folha.
-- ============================================================================


-- ============================================================================
-- 1. FONTE UNICA: de quem e este identificador?
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_servidor_por_identificador_afd(
    p_dispositivo_id uuid,
    p_identificador  text
)
RETURNS TABLE (servidor_id uuid, origem_match text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_chave    text;
    v_vinculo  uuid;
    v_por_cpf  uuid;
    v_por_pis  uuid;
    v_n_cpf    integer;
    v_n_pis    integer;
BEGIN
    -- right(...,11) e NUNCA ltrim(...,'0'): CPF que comeca com zero perderia um digito
    -- (CLAUDE.md armadilha 10). Vale igual para PIS.
    v_chave := right(regexp_replace(COALESCE(p_identificador, ''), '\\D', '', 'g'), 11);
    IF length(v_chave) < 11 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    -- 1) Vinculo vigente manda em tudo: e a decisao humana ja registrada para ESTE dispositivo.
    SELECT v.servidor_id INTO v_vinculo
      FROM public.rep_vinculos_servidor v
     WHERE v.dispositivo_id = p_dispositivo_id
       AND right(regexp_replace(v.identificador_afd, '\\D', '', 'g'), 11) = v_chave
       AND v.vigente_ate IS NULL
     ORDER BY v.vigente_de DESC
     LIMIT 1;

    IF v_vinculo IS NOT NULL THEN
        RETURN QUERY SELECT v_vinculo, 'vinculo'::text;
        RETURN;
    END IF;

    -- 2) CPF. Conta antes de escolher: dois servidores Ativos com o mesmo CPF nao podem virar
    -- um casamento arbitrario (a base permite duas matriculas para a mesma pessoa - ver
    -- servidores.vinculo_multiplo_confirmado).
    -- (array_agg(...))[1] e NAO min(): nao existe min(uuid) no Postgres, e plpgsql so descobre
    -- isso na EXECUCAO (armadilha 1) - o CREATE passa feliz. Pego pelo portao em homologacao.
    SELECT count(*), (array_agg(s.id))[1] INTO v_n_cpf, v_por_cpf
      FROM public.servidores s
     WHERE s.status = 'Ativo'
       AND right(regexp_replace(COALESCE(s.cpf, ''), '\\D', '', 'g'), 11) = v_chave
       AND length(regexp_replace(COALESCE(s.cpf, ''), '\\D', '', 'g')) >= 11;

    -- 3) PIS/NIS. O legado da SMS vive aqui.
    -- (array_agg(...))[1] e NAO min(): nao existe min(uuid) no Postgres, e plpgsql so descobre
    -- isso na EXECUCAO (armadilha 1) - o CREATE passa feliz. Pego pelo portao em homologacao.
    SELECT count(*), (array_agg(s.id))[1] INTO v_n_pis, v_por_pis
      FROM public.servidores s
     WHERE s.status = 'Ativo'
       AND right(regexp_replace(COALESCE(s.pis_pasep, ''), '\\D', '', 'g'), 11) = v_chave
       AND length(regexp_replace(COALESCE(s.pis_pasep, ''), '\\D', '', 'g')) >= 11;

    -- Ambiguidade nunca vira chute. Tres casos, todos devolvem NULL de proposito:
    --   * mais de um servidor pelo mesmo CPF
    --   * mais de um servidor pelo mesmo PIS
    --   * CPF aponta para uma pessoa e PIS para OUTRA
    -- Sem dono e um problema visivel na tela de higiene; dono errado e ponto de uma pessoa
    -- lancado para outra, e ninguem descobre.
    IF v_n_cpf > 1 OR v_n_pis > 1 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_por_cpf IS NOT NULL AND v_por_pis IS NOT NULL AND v_por_cpf <> v_por_pis THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_por_cpf IS NOT NULL THEN
        RETURN QUERY SELECT v_por_cpf, 'cpf'::text;
    ELSIF v_por_pis IS NOT NULL THEN
        RETURN QUERY SELECT v_por_pis, 'pis'::text;
    ELSE
        RETURN QUERY SELECT NULL::uuid, NULL::text;
    END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) IS
    'De quem e este identificador de AFD, neste dispositivo. Tenta vinculo vigente, depois CPF, '
    'depois PIS/NIS - porque o identificador nao e uma propriedade do AFD, e o numero que foi '
    'digitado no cadastro daquela pessoa naquele relogio (a SMS veio cadastrada por PIS). '
    'Devolve NULL, nunca um chute, quando ha ambiguidade: CPF e PIS apontando para pessoas '
    'diferentes, ou mais de um servidor Ativo com o mesmo numero. FONTE UNICA - nao replicar '
    'esta regra em outra funcao nem no frontend.';


-- ============================================================================
-- 2. origem_match passa a aceitar 'pis'
-- ============================================================================
-- O CHECK original (20260812040000) so admitia 'vinculo' e 'cpf'; gravar 'pis' violaria e
-- derrubaria o snapshot inteiro.

ALTER TABLE public.rep_usuarios_dispositivo
    DROP CONSTRAINT IF EXISTS rep_usuarios_dispositivo_origem_match_check;

ALTER TABLE public.rep_usuarios_dispositivo
    ADD CONSTRAINT rep_usuarios_dispositivo_origem_match_check
    CHECK (origem_match IS NULL OR origem_match IN ('vinculo', 'cpf', 'pis'));


-- ============================================================================
-- 3. SNAPSHOT DO RELOGIO passa a usar a fonte unica
-- ============================================================================

`

const MEIO = `

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;


-- ============================================================================
-- 4. COBERTURA DA ESCALA para de mentir
-- ============================================================================

`

const RODAPE = `

GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 5. O COMMENT de fn_vincular_cadastros_por_cpf estava enganando
-- ============================================================================
-- O corpo dela NAO casa por CPF: ele le rep_usuarios_dispositivo.servidor_id, ja resolvido pelo
-- snapshot. Por isso ela passa a funcionar com PIS sem nenhuma alteracao de corpo - e por isso o
-- nome/COMMENT precisavam ser corrigidos antes que alguem concluisse o contrario.

COMMENT ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) IS
    'Cria vinculos para os servidores que o snapshot do relogio JA resolveu '
    '(rep_usuarios_dispositivo.servidor_id). Apesar do nome, nao casa por CPF aqui: quem casa e '
    'fn_servidor_por_identificador_afd, na ingestao do snapshot, tentando vinculo, CPF e PIS. '
    'Nao escreve no equipamento e NAO reprocessa AFD ja ingerido - p_vigente_de decide quais '
    'batidas passam a ter dono num futuro fn_reparse_afd_dispositivo. Permitido para gestores e '
    'administradores no escopo.';


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA, E NESTA ORDEM
-- ============================================================================
-- ⚠️ APLIQUE EM HOMOLOGACAO PRIMEIRO. As tres funcoes daqui sao plpgsql, e plpgsql resolve nome
-- de coluna e existencia de funcao SO NA EXECUCAO (CLAUDE.md armadilha 1): "CREATE OR REPLACE sem
-- erro" NAO prova nada. Foi exatamente assim que o portao em homologacao pegou um min(uuid)
-- inexistente nesta propria migration - a funcao criou feliz e explodiu ao rodar.
--
-- 0. TESTE DE FUMACA: EXECUTAR as tres, nao so criar. Em banco sem dado nenhum elas tem que
--    devolver vazio SEM ERRO. Se alguma estourar aqui, pare - nao vai a producao.
--
-- SELECT * FROM public.fn_servidor_por_identificador_afd(gen_random_uuid(), '000000000191');
-- SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--          (SELECT id FROM public.dispositivos_rep LIMIT 1), '[]'::jsonb);
-- SELECT count(*) FROM public.dispositivos_rep d
--   CROSS JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, 8, 2026) c;
--
-- 1. A fonte unica responde certo nos dois mundos? (troque os uuid/numeros)
--
-- SELECT * FROM public.fn_servidor_por_identificador_afd(
--     '<dispositivo>', '000123456789');
--
-- 2. Reprocessar o snapshot e ver o PIS aparecer. NAO e destrutivo em outro sentido: o snapshot
--    e substituido por inteiro a cada relato, por desenho. Rode "Atualizar lista de cadastros do
--    relogio" na bandeja da unidade, ou o coletor-rep higiene, e depois:
--
-- SELECT origem_match, count(*)
--   FROM public.rep_usuarios_dispositivo
--  WHERE dispositivo_id = '<dispositivo da SMS>'
--  GROUP BY origem_match ORDER BY 2 DESC;
--   -- esperado: 'pis' com ~48, NULL com ~275 (os que nao sao servidor nenhum - publico da
--   -- higiene), e nenhum erro de CHECK.
--
-- 3. O PORTAO desta migration - a cobertura tem que MUDAR na SMS e NAO mudar nos outros:
--
-- SELECT d.nome, c.situacao, count(*)
--   FROM public.dispositivos_rep d
--   CROSS JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, 8, 2026) c
--  GROUP BY d.nome, c.situacao ORDER BY d.nome, 3 DESC;
--
--   SMS antes: 125 fora_do_relogio + 1 sem_cpf
--   SMS esperado depois: ~27 sem_vinculo (ou sem_biometria), ~83 fora_do_relogio, ~15 sem_cpf
--   LACEM / CEI / Reg-TI-TFD: IDENTICO ao de antes. Qualquer mudanca neles e regressao -
--   pare e investigue, porque a medicao dizia CONFLITO=0 nos tres.
`

const conteudo = CABECALHO + snapshot + MEIO + cobertura + RODAPE

// Conferencia estrutural do arquivo inteiro (gen_dobra.js ganhou isso na marra, CLAUDE.md).
const delim = (conteudo.match(/\$fn\$/g) || []).length
if (delim % 2 !== 0) throw new Error(`ABORTA: delimitadores $fn$ impares (${delim}) - dollar-quoting quebrado`)
const creates = (conteudo.match(/CREATE OR REPLACE FUNCTION/g) || []).length
if (creates !== 3) throw new Error(`ABORTA: esperava 3 CREATE OR REPLACE FUNCTION, achei ${creates}`)
if (!conteudo.includes('$$')) {
  // ok - este projeto usa $fn$; a checagem existe so para pegar corrupcao por String.replace
} else {
  throw new Error('ABORTA: apareceu $$ no resultado - sinal de replace com string em vez de funcao')
}

fs.writeFileSync(SAIDA, conteudo.replace(/\n/g, '\r\n'), 'utf8')
console.log('OK: gerado', path.relative(RAIZ, SAIDA))
console.log('   delimitadores $fn$:', delim, '| CREATE OR REPLACE:', creates)
console.log('   bytes:', fs.statSync(SAIDA).size)
