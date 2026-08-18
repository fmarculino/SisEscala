// Gera 20260817180000_fila_cadastro_retry_e_identificador_do_device.sql
//
// Cópia MECÂNICA (CLAUDE.md armadilha 1) do corpo vigente de fn_confirmar_cadastro_rep
// (20260812000000_add_rep_cadastros_push.sql) com substituições pontuais, e de
// fn_cadastros_pendentes_dispositivo (mesmo arquivo). Aborta se qualquer invariante divergir.
//
// ⚠️ Segundo argumento de String.replace é SEMPRE função (CLAUDE.md / gen_dobra.js).

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')
const SAIDA = path.join(MIG, '20260817180000_fila_cadastro_retry_e_identificador_do_device.sql')

const origem = fs
  .readFileSync(path.join(MIG, '20260812000000_add_rep_cadastros_push.sql'), 'utf8')
  .replace(/\r\n/g, '\n')

function extrairFuncao(texto, nome) {
  const inicio = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}`)
  if (inicio < 0) throw new Error(`ABORTA: nao achei CREATE de ${nome}`)
  const fim = texto.indexOf('\n$fn$;', inicio)
  if (fim < 0) throw new Error(`ABORTA: nao achei fim do corpo de ${nome}`)
  return texto.slice(inicio, fim + '\n$fn$;'.length)
}

function trocar(texto, de, para, onde) {
  const partes = texto.split(de)
  if (partes.length !== 2) {
    throw new Error(
      `ABORTA: "${onde}" apareceu ${partes.length - 1}x (esperado 1). O corpo vigente mudou.`
    )
  }
  return partes[0] + para + partes[1]
}

// ============================================================================
// 1. fn_cadastros_pendentes_dispositivo: respeitar a espera do backoff
// ============================================================================
let pendentes = extrairFuncao(origem, 'fn_cadastros_pendentes_dispositivo')

pendentes = trocar(
  pendentes,
  `     WHERE f.dispositivo_id = p_dispositivo_id
       AND f.status = 'pendente'
     ORDER BY f.created_at`,
  `     WHERE f.dispositivo_id = p_dispositivo_id
       AND f.status = 'pendente'
       -- Falha de TRANSPORTE devolve o item para 'pendente' com uma espera (ver
       -- fn_confirmar_cadastro_rep). Sem este filtro, o ciclo automatico tentaria o mesmo
       -- cadastro a cada 5 minutos contra um relogio que esta fora do ar.
       AND (f.proxima_tentativa_em IS NULL OR f.proxima_tentativa_em <= now())
     ORDER BY f.created_at`,
  'WHERE de fn_cadastros_pendentes_dispositivo'
)

// ============================================================================
// 2. fn_confirmar_cadastro_rep: identificador do device + falha transitoria
// ============================================================================
let confirmar = extrairFuncao(origem, 'fn_confirmar_cadastro_rep')

confirmar = trocar(
  confirmar,
  `    p_device_user_id bigint DEFAULT NULL,
    p_erro           text DEFAULT NULL
)`,
  `    p_device_user_id bigint DEFAULT NULL,
    p_erro           text DEFAULT NULL,
    -- O identificador que o EQUIPAMENTO reportou depois de criar o usuario, lido de volta por
    -- relistagem. NULL cai no calculo antigo a partir do CPF, que continua correto para os
    -- relogios cadastrados por CPF.
    p_identificador_afd text DEFAULT NULL,
    -- true = nao consegui FALAR com o relogio (rede, timeout, equipamento desligado). false =
    -- o relogio respondeu e RECUSOU. Sao dois problemas diferentes e tem destinos diferentes.
    p_transitorio    boolean DEFAULT false
)`,
  'assinatura de fn_confirmar_cadastro_rep'
)

confirmar = trocar(
  confirmar,
  `DECLARE
    v_dispositivo_id uuid;
    v_servidor_id    uuid;
BEGIN`,
  `DECLARE
    v_dispositivo_id uuid;
    v_servidor_id    uuid;
    v_tentativas     integer;
    v_ident          text;
    -- Teto de tentativas para falha transitoria. Sem teto, um relogio removido da unidade
    -- deixaria itens em 'pendente' para sempre e ninguem olharia a tela de erro.
    c_max_tentativas constant integer := 5;
BEGIN`,
  'DECLARE de fn_confirmar_cadastro_rep'
)

confirmar = trocar(
  confirmar,
  `    SELECT dispositivo_id, servidor_id INTO v_dispositivo_id, v_servidor_id
      FROM public.rep_cadastros_fila WHERE id = p_fila_id AND status = 'pendente';`,
  `    SELECT dispositivo_id, servidor_id, tentativas
      INTO v_dispositivo_id, v_servidor_id, v_tentativas
      FROM public.rep_cadastros_fila WHERE id = p_fila_id AND status = 'pendente';`,
  'SELECT inicial de fn_confirmar_cadastro_rep'
)

confirmar = trocar(
  confirmar,
  `    IF NOT p_sucesso THEN
        UPDATE public.rep_cadastros_fila
           SET status = 'falhou', erro = p_erro, tentativas = tentativas + 1, processado_em = now()
         WHERE id = p_fila_id;
        RETURN;
    END IF;`,
  `    IF NOT p_sucesso THEN
        -- RECUSA do equipamento (ou teto de tentativas atingido) e' definitiva: insistir a cada
        -- ciclo repetiria o mesmo erro contra o relogio e encheria o log. Vai para 'falhou', que
        -- e' visivel na tela de Cobertura da Escala (coluna fila_erro).
        IF NOT p_transitorio OR v_tentativas + 1 >= c_max_tentativas THEN
            UPDATE public.rep_cadastros_fila
               SET status = 'falhou', erro = p_erro, tentativas = tentativas + 1,
                   processado_em = now(), proxima_tentativa_em = NULL
             WHERE id = p_fila_id;
            RETURN;
        END IF;

        -- Falha de TRANSPORTE: o cadastro daquela pessoa nao pode ser queimado porque o relogio
        -- estava desligado no minuto do ciclo. Continua 'pendente', com espera crescente.
        -- Antes desta migration TODA falha era terminal, e o ciclo automatico transformaria um
        -- blecaute de 1 minuto em servidor que nunca consegue bater ponto, sem alarme nenhum.
        UPDATE public.rep_cadastros_fila
           SET erro = p_erro,
               tentativas = tentativas + 1,
               proxima_tentativa_em = now() + (interval '5 minutes' * (tentativas + 1))
         WHERE id = p_fila_id;
        RETURN;
    END IF;`,
  'ramo de falha de fn_confirmar_cadastro_rep'
)

confirmar = trocar(
  confirmar,
  `    UPDATE public.rep_cadastros_fila
       SET status = 'enviado', device_user_id = p_device_user_id, processado_em = now()
     WHERE id = p_fila_id;`,
  `    UPDATE public.rep_cadastros_fila
       SET status = 'enviado', device_user_id = p_device_user_id, processado_em = now(),
           proxima_tentativa_em = NULL
     WHERE id = p_fila_id;`,
  'UPDATE de sucesso de fn_confirmar_cadastro_rep'
)

confirmar = trocar(
  confirmar,
  `    INSERT INTO public.rep_vinculos_servidor
           (dispositivo_id, identificador_afd, matricula_device, nome_device, servidor_id, device_user_id, tem_biometria)
    SELECT v_dispositivo_id,
           lpad(regexp_replace(COALESCE(s.cpf, ''), '\\D', '', 'g'), 12, '0'),
           s.matricula, s.nome, s.id, p_device_user_id, false
      FROM public.servidores s WHERE s.id = v_servidor_id;`,
  `    -- O identificador do vinculo e' o que o EQUIPAMENTO reportou, nao o que o CPF produziria.
    -- Isso e' o conserto do modo de falha silencioso descoberto em 17/08/2026 na SMS: naquele
    -- relogio (cadastrado por PIS pelo sistema anterior) o calculo por CPF criaria um vinculo com
    -- identificador que NUNCA casa com as linhas do AFD - e nada reclamaria, as batidas so
    -- continuariam orfas. Se um modelo de relogio guardar o cadastro sob outro numero que o que
    -- mandamos, e' ele quem esta certo: e' o numero dele que aparece na marcacao.
    --
    -- Normaliza para as 12 posicoes do AFD sem nunca cortar digito pela esquerda (armadilha 10):
    -- pega os digitos, mantem os 12 ultimos e completa com zero a esquerda.
    v_ident := NULLIF(regexp_replace(COALESCE(p_identificador_afd, ''), '\\D', '', 'g'), '');
    IF v_ident IS NOT NULL THEN
        v_ident := lpad(right(v_ident, 12), 12, '0');
    END IF;

    INSERT INTO public.rep_vinculos_servidor
           (dispositivo_id, identificador_afd, matricula_device, nome_device, servidor_id, device_user_id, tem_biometria)
    SELECT v_dispositivo_id,
           COALESCE(v_ident, lpad(regexp_replace(COALESCE(s.cpf, ''), '\\D', '', 'g'), 12, '0')),
           s.matricula, s.nome, s.id, p_device_user_id, false
      FROM public.servidores s WHERE s.id = v_servidor_id;`,
  'INSERT do vinculo em fn_confirmar_cadastro_rep'
)

// ============================================================================
// 3. Invariantes
// ============================================================================
function conferir(nome, texto, esperados) {
  for (const [padrao, qtd] of esperados) {
    const achados = texto.split(padrao).length - 1
    if (achados !== qtd) throw new Error(`ABORTA: em ${nome}, "${padrao}" aparece ${achados}x (esperado ${qtd}).`)
  }
}

conferir('fn_confirmar_cadastro_rep', confirmar, [
  // O guard de idempotencia (reenvio seguro) nao pode ter sumido.
  ['RETURN; -- ja processado ou id invalido', 1],
  // O fechamento do vinculo anterior tambem nao - sem ele, correcao de hoje reescreve autoria
  // de batida antiga.
  ["SET vigente_ate = now()", 1],
  ['COALESCE(v_ident,', 1],
  ['p_transitorio', 2],   // 1 na assinatura + 1 no IF
  ['c_max_tentativas', 2],
])

conferir('fn_cadastros_pendentes_dispositivo', pendentes, [
  ['proxima_tentativa_em', 2],  // 1 no comentario + 1 no filtro
  ["f.status = 'pendente'", 1],
])

// ============================================================================
// 4. Monta
// ============================================================================
const CABECALHO = `-- ============================================================================
-- Fila de cadastro REP: identificador do equipamento e falha transitoria (17/08/2026)
-- ============================================================================
-- ARQUIVO GERADO por scratchpad/gen_fila_cadastro_retry.js. Nao editar a mao - regerar.
-- fn_cadastros_pendentes_dispositivo e fn_confirmar_cadastro_rep sao copia mecanica do corpo
-- vigente (20260812000000) com substituicoes pontuais; o script aborta se qualquer invariante
-- divergir (CLAUDE.md armadilha 1).
--
-- Complementa 20260817170000 (resolucao de identidade por CPF ou PIS). Aquela consertou a
-- LEITURA (snapshot e cobertura); esta conserta a ESCRITA (o push de cadastro).
--
-- DOIS PROBLEMAS, MEDIDOS EM PRODUCAO
--
-- 1) O vinculo criado pelo push usava lpad(cpf,12,'0') - um numero CALCULADO por nos, nao o que
--    o equipamento guardou. No relogio da SMS isso produziria vinculo que jamais casa com as
--    linhas do AFD (que carregam PIS), em silencio absoluto: as 265.922 marcacoes continuariam
--    orfas e a tela diria que estava tudo certo. Agora o coletor reporta o identificador lido de
--    volta do proprio relogio, e e' ELE que vira o vinculo. Quando nao vem (relogio que nao
--    permite relistar), cai no calculo por CPF, que segue correto nos outros tres dispositivos.
--
-- 2) Toda falha era TERMINAL. fn_confirmar_cadastro_rep marcava 'falhou' e
--    fn_cadastros_pendentes_dispositivo so serve 'pendente', entao o item saia da fila para
--    sempre - a coluna tentativas existia mas nunca passava de 1. Com humano clicando o botao
--    isso era tolerable (ele ve o erro e clica de novo); no ciclo AUTOMATICO que vem a seguir,
--    um relogio desligado por um minuto queimaria o cadastro de uma pessoa permanentemente, e
--    ninguem ficaria sabendo. Agora:
--
--      * relogio RECUSOU (respondeu erro)      -> 'falhou', definitivo, visivel na tela
--      * nao consegui FALAR com o relogio      -> continua 'pendente', espera 5min x tentativa
--      * 5 tentativas transitorias sem sucesso -> 'falhou', para nao ficar pendente para sempre
--
-- O QUE NAO MUDA
--   * Cadastro novo continua sendo enviado por CPF (o identificador_afd que
--     fn_cadastros_pendentes_dispositivo devolve ao coletor).
--   * Idempotencia: confirmar duas vezes o mesmo item continua no-op.
--   * O fechamento do vinculo vigente anterior antes de abrir outro continua no lugar.
--
-- ⚠️ DROP antes do CREATE em fn_confirmar_cadastro_rep: a assinatura GANHA parametros com
-- DEFAULT, e sem derrubar a de 4 argumentos toda chamada com 4 argumentos ficaria AMBIGUA
-- (o Postgres nao escolhe entre f(a,b,c,d) e f(a,b,c,d,e DEFAULT,f DEFAULT)). Nao e o mesmo caso
-- do 42P13 de RETURNS TABLE, mas quebra igual - e so em tempo de execucao da rota.
-- ============================================================================


-- ============================================================================
-- 1. Coluna de espera do backoff
-- ============================================================================

ALTER TABLE public.rep_cadastros_fila
    ADD COLUMN IF NOT EXISTS proxima_tentativa_em timestamptz;

COMMENT ON COLUMN public.rep_cadastros_fila.proxima_tentativa_em IS
    'Quando este item volta a ser servido ao coletor. Preenchido so em falha de TRANSPORTE '
    '(relogio inalcancavel), nunca em recusa do equipamento. NULL = disponivel agora.';

-- O indice de busca do coletor passa a considerar a espera.
CREATE INDEX IF NOT EXISTS idx_cadastro_fila_pendente_disponivel
    ON public.rep_cadastros_fila (dispositivo_id, proxima_tentativa_em)
    WHERE status = 'pendente';


-- ============================================================================
-- 2. O coletor so recebe o que ja pode ser tentado
-- ============================================================================

`

const MEIO = `

REVOKE ALL ON FUNCTION public.fn_cadastros_pendentes_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cadastros_pendentes_dispositivo(uuid) TO service_role;


-- ============================================================================
-- 3. Confirmacao: identificador do device, e falha com destino certo
-- ============================================================================
-- Ver o aviso do DROP no cabecalho. Sem CASCADE de proposito: se algo depender da assinatura
-- antiga, e melhor dar erro aqui do que sumir em silencio.

DROP FUNCTION IF EXISTS public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text);

`

const RODAPE = `

REVOKE ALL ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean)
    TO service_role;

COMMENT ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean) IS
    'Fecha um item da fila de push de cadastro. Sucesso cria rep_vinculos_servidor usando o '
    'identificador que o EQUIPAMENTO reportou (p_identificador_afd), caindo para lpad(cpf,12) '
    'quando nao vier. p_transitorio separa "nao alcancei o relogio" (volta para pendente com '
    'espera de 5min x tentativa, teto de 5) de "o relogio recusou" (falhou, definitivo). '
    'Idempotente: confirmar item ja processado e no-op.';


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA (plpgsql so falha na EXECUCAO, armadilha 1)
-- ============================================================================
-- Rode em HOMOLOGACAO primeiro. "CREATE sem erro" nao prova nada nestas funcoes.
--
-- 0. TESTE DE FUMACA - as duas tem que EXECUTAR:
--
-- SELECT * FROM public.fn_cadastros_pendentes_dispositivo(gen_random_uuid());
-- SELECT public.fn_confirmar_cadastro_rep(gen_random_uuid(), false, NULL, 'teste', NULL, true);
--   -- esperado: vazio / void, sem erro. (uuid inexistente = no-op idempotente)
--
-- 1. A assinatura antiga de 4 argumentos NAO pode ter sobrado (ambiguidade):
--
-- SELECT count(*) AS versoes, string_agg(pg_get_function_identity_arguments(oid), ' | ')
--   FROM pg_proc WHERE proname = 'fn_confirmar_cadastro_rep';
--   -- esperado: versoes = 1
--
-- 2. Estado da fila da SMS depois do proximo push (as 327 de hoje estao em 'falhou' por recusa
--    do equipamento - continuam falhou, esta migration nao ressuscita nada):
--
-- SELECT status, count(*), count(*) FILTER (WHERE proxima_tentativa_em IS NOT NULL) AS esperando
--   FROM public.rep_cadastros_fila
--  WHERE dispositivo_id = '3d8547de-8dd7-4a30-b035-6b7d64fb49f7'
--  GROUP BY status;
--
-- 3. Reenfileirar as 327 SO depois de a Parte 5 (formato aceito pelo add_users.fcgi deste
--    modelo) estar confirmada em campo com coletor-rep-cli cadastros-testar. Reenfileirar antes
--    disso so produz 327 recusas de novo.
`

const conteudo = CABECALHO + pendentes + MEIO + confirmar + RODAPE

const delim = (conteudo.match(/\$fn\$/g) || []).length
if (delim % 2 !== 0) throw new Error(`ABORTA: delimitadores $fn$ impares (${delim})`)
const creates = (conteudo.match(/CREATE OR REPLACE FUNCTION/g) || []).length
if (creates !== 2) throw new Error(`ABORTA: esperava 2 CREATE OR REPLACE FUNCTION, achei ${creates}`)
if (conteudo.includes('$$')) throw new Error('ABORTA: apareceu $$ - replace com string em vez de funcao')

fs.writeFileSync(SAIDA, conteudo.replace(/\n/g, '\r\n'), 'utf8')
console.log('OK: gerado', path.relative(RAIZ, SAIDA))
console.log('   $fn$:', delim, '| CREATE OR REPLACE:', creates, '| bytes:', fs.statSync(SAIDA).size)
