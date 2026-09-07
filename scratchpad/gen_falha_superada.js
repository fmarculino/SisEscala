// Gera 20260907100000_fila_rep_falha_superada_nao_reprova.sql a partir da migration VIGENTE de
// fn_cadastro_rep_reprovado (20260905110000). Copia mecanica: aborta se qualquer substituicao
// nao bater na contagem esperada. Nao redigite o corpo da funcao a mao.
const fs = require('fs')
const FONTE = 'supabase/migrations/20260905110000_fila_rep_nao_reenfileira_recusado.sql'
const SAIDA = 'supabase/migrations/20260907100000_fila_rep_falha_superada_nao_reprova.sql'

const src = fs.readFileSync(FONTE, 'utf8')
const CRLF = src.includes('\r\n')
const t = src.replace(/\r\n/g, '\n')

const conta = (hay, needle) => hay.split(needle).length - 1
function exigir(cond, msg) { if (!cond) { console.error('ABORTADO: ' + msg); process.exit(1) } }

// 1. Extrair o corpo VIGENTE da funcao, do CREATE ate o fechamento do dollar-quote.
const ini = t.indexOf('CREATE OR REPLACE FUNCTION public.fn_cadastro_rep_reprovado(')
exigir(ini >= 0, 'nao achei fn_cadastro_rep_reprovado em ' + FONTE)
const marcaFim = '$fn$;'
const fim = t.indexOf(marcaFim, ini)
exigir(fim > ini, 'nao achei o fechamento do dollar-quote da funcao')
let fn = t.slice(ini, fim + marcaFim.length)

// Invariantes da fonte: as tres condicoes que a versao vigente tem.
exigir(conta(fn, "f.status = 'falhou'") === 1, "esperava 1 ocorrencia de f.status = 'falhou'")
exigir(conta(fn, "interval '30 days'") === 1, 'esperava 1 ocorrencia do teto de 30 dias')
exigir(conta(fn, 's.updated_at') === 1, 'esperava 1 ocorrencia de s.updated_at')
exigir(conta(fn, 'SECURITY DEFINER') === 1, 'esperava SECURITY DEFINER')

// 2. Ancora: a ultima condicao do WHERE, logo antes do fechamento do EXISTS.
const ANCORA = [
  "           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(s.updated_at, '-infinity'::timestamptz)",
  '    );',
].join('\n')
exigir(conta(fn, ANCORA) === 1, 'esperava exatamente 1 ancora (ultima condicao do WHERE)')

const NOVAS = [
  "           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(s.updated_at, '-infinity'::timestamptz)",
  '           -- (1) Falha SUPERADA nao e a ultima palavra. O EXISTS original olhava so as linhas',
  "           -- 'falhou' e ignorava um 'enviado' POSTERIOR do mesmo par - entao quem falhou algumas",
  '           -- vezes e depois ENTROU no relogio ficava marcado como recusado por ate 30 dias.',
  '           -- Inerte enquanto a pessoa esta no equipamento; morde quando o cadastro precisa ser',
  '           -- refeito (troca de aparelho, higiene, vinculo encerrado). Caso real: CAF-02, 07/09.',
  '           AND NOT EXISTS (',
  '                 SELECT 1',
  '                   FROM public.rep_cadastros_fila f2',
  '                  WHERE f2.dispositivo_id = f.dispositivo_id',
  '                    AND f2.servidor_id    = f.servidor_id',
  "                    AND f2.status = 'enviado'",
  '                    AND COALESCE(f2.processado_em, f2.created_at)',
  '                      > COALESCE(f.processado_em, f.created_at))',
  '           -- (2) Recusa de um equipamento SUBSTITUIDO nao vale para o que esta no lugar dele. E',
  '           -- o caso extremo do que o teto de 30 dias ja admitia ("quem mudou foi o outro lado"):',
  '           -- aqui o outro lado e outro aparelho fisico. Sem isso, toda troca de relogio herda a',
  '           -- lista de recusados do anterior, e ninguem ve - fn_registrar_substituicao_dispositivo',
  '           -- nao toca na fila de proposito (nao deve escrever em tabela de outro assunto).',
  '           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(',
  '                 (SELECT MAX(sb.created_at)',
  '                    FROM public.dispositivos_rep_substituicoes sb',
  '                   WHERE sb.dispositivo_id = f.dispositivo_id),',
  "                 '-infinity'::timestamptz)",
  '    );',
].join('\n')

fn = fn.replace(ANCORA, () => NOVAS)
exigir(conta(fn, "f2.status = 'enviado'") === 1, 'a clausula de sucesso posterior nao entrou')
exigir(conta(fn, 'dispositivos_rep_substituicoes') === 1, 'a clausula de substituicao nao entrou')
exigir(conta(fn, "f.status = 'falhou'") === 1, 'o criterio original de falhou foi perdido')
exigir(conta(fn, "interval '30 days'") === 1, 'o teto de 30 dias foi perdido')
exigir(conta(fn, 's.updated_at') === 1, 'o criterio de updated_at foi perdido')
exigir(conta(fn, 'SECURITY DEFINER') === 1, 'SECURITY DEFINER foi perdido')

const cabecalho = `-- ============================================================================
-- A fila para de reprovar por falha que JA FOI SUPERADA (07/09/2026)
-- ============================================================================
--
-- MOTIVACAO (medida em producao em 07/09/2026, com autorizacao do usuario). O REP
-- Almox-Pat-CAF-02 foi trocado por outro aparelho. Depois de registrar a substituicao, 58 dos 59
-- cadastros voltaram ao equipamento - e um ficou de fora sem nenhuma mensagem: MANUEL CONCEICAO
-- FARIAS NETO (mat 65879). A fila dele naquele relogio tem SEIS linhas, nao cinco:
--
--     02/09 11:05  falhou   nenhum formato de add_users.fcgi funcionou
--     02/09 13:55  falhou   idem
--     02/09 14:40  falhou   idem
--     02/09 14:50  falhou   Matricula ja cadastrada
--     02/09 14:55  falhou   idem
--     02/09 17:50  enviado  <- deu certo, no mesmo dia
--
-- fn_cadastro_rep_reprovado faz um EXISTS sobre linhas 'falhou' e NAO olha se existe um 'enviado'
-- posterior. As 5 falhas sao mais novas que o updated_at do cadastro dele e estao dentro dos 30
-- dias, entao ele contava como "o equipamento recusou, nao insista" - por uma recusa que ja tinha
-- sido superada, num aparelho que nem esta mais instalado ali.
--
-- ⚠️ MEDIR EXECUTANDO, NUNCA ESTIMANDO. A primeira estimativa deste efeito foi feita em JS sobre a
-- fila e deu 167 pares; ela havia esquecido a terceira condicao do criterio (a falha precisa ser
-- mais nova que servidores.updated_at). CHAMANDO a funcao par a par, o numero real e outro:
--
--     237 pares (dispositivo, servidor) com alguma falha
--      43 reprovados hoje
--      14 deles por falha SUPERADA por sucesso posterior  <- o defeito
--      29 recusa legitima (o equipamento recusou e ninguem entrou depois)
--       1 unico preso AGORA por reprovacao indevida: o MANUEL no CAF-02
--
-- Os outros 13 estao inertes hoje (a pessoa ja esta no relogio, entao o enfileiramento a pularia
-- de qualquer jeito). Eles sao a mina: aparecem na proxima higiene ou troca de aparelho.
--
-- ⚠️ Os 29 legitimos NAO sao desbloqueados por esta migration, e nao devem ser. Sao recusas reais
-- (HMI e HMM, em geral matricula/PIS ja ocupados no proprio equipamento por cadastro do sistema
-- anterior). O conserto deles e achar o cadastro antigo, nao insistir na fila.
--
-- A clausula (2) nao desbloqueia NINGUEM hoje (0 casos): o MANUEL ja e liberado pela (1). Ela e
-- preventiva, e entra junto porque o caso que a motivou acabou de acontecer.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_falha_superada.js
-- O gerador copia a funcao da migration VIGENTE (20260905110000) e aborta se qualquer
-- substituicao nao bater na contagem.
--
-- Assinatura inalterada: CREATE OR REPLACE puro, sem DROP e sem risco de PGRST203 (armadilha 41).
-- As duas funcoes de enfileiramento (fn_enfileirar_cadastros_rep e
-- fn_enfileirar_cadastros_por_escala) chamam esta como fonte unica e NAO precisam ser recriadas.
-- ============================================================================


`

const rodape = `

-- Assinatura inalterada, entao CREATE OR REPLACE preserva os privilegios. Reafirmados mesmo assim:
-- em migration de funcao, o que vale e o que esta escrito aqui (armadilha 24).
REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) IS
    'true quando o equipamento ja RECUSOU este cadastro, nada mudou desde entao, NENHUM envio '
    'posterior deu certo e a recusa nao veio de um aparelho ja substituido - fonte unica do '
    '"nao insista" usada por fn_enfileirar_cadastros_rep e fn_enfileirar_cadastros_por_escala.';


-- ============================================================================
-- CONFERENCIA - a migration EXECUTA a funcao e aborta se ela nao fizer o que diz
-- ============================================================================
-- ⚠️ Conferir que a funcao EXISTE nao serve: ela existia e estava errada. plpgsql/sql so resolvem
-- nome de coluna na EXECUCAO (armadilha 42), e o defeito aqui era de logica, nao de sintaxe.
-- Por isso as duas assercoes CHAMAM a funcao sobre os pares REAIS da fila.
--
-- Em base sem dados as duas passam vazias, o que e honesto: nao ha o que conferir. O portao de
-- verdade e a execucao contra producao, em scratchpad/an_reprovado_estado.mjs (antes/depois).

DO $conf$
DECLARE
    v_indevidos          int;
    v_legitimos_perdidos int;
BEGIN
    -- (A) Nao pode sobrar NENHUM par reprovado que ja teve envio bem-sucedido posterior a falha.
    SELECT count(*) INTO v_indevidos
      FROM (
        SELECT f.dispositivo_id, f.servidor_id,
               max(COALESCE(f.processado_em, f.created_at)) FILTER (WHERE f.status = 'falhou')  AS ult_falha,
               max(COALESCE(f.processado_em, f.created_at)) FILTER (WHERE f.status = 'enviado') AS ult_ok
          FROM public.rep_cadastros_fila f
         GROUP BY f.dispositivo_id, f.servidor_id
      ) p
     WHERE p.ult_falha IS NOT NULL
       AND p.ult_ok    IS NOT NULL
       AND p.ult_ok    > p.ult_falha
       AND public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id);

    IF v_indevidos > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % par(es) continuam reprovados mesmo com envio bem-sucedido posterior a ultima falha.', v_indevidos;
    END IF;

    -- (B) O sentido inverso, que e o mais facil de quebrar sem perceber: uma recusa LEGITIMA e
    -- recente (nada mudou no cadastro, nenhum envio deu certo depois, aparelho nao substituido)
    -- tem que CONTINUAR reprovada. Afrouxar demais recria o laco que 20260905110000 fechou:
    -- entrada condenada consumindo a vaga de quem e novo, no teto de 20 cadastros por ciclo.
    SELECT count(*) INTO v_legitimos_perdidos
      FROM (
        SELECT f.dispositivo_id, f.servidor_id,
               max(COALESCE(f.processado_em, f.created_at)) FILTER (WHERE f.status = 'falhou')  AS ult_falha,
               max(COALESCE(f.processado_em, f.created_at)) FILTER (WHERE f.status = 'enviado') AS ult_ok
          FROM public.rep_cadastros_fila f
         GROUP BY f.dispositivo_id, f.servidor_id
      ) p
      JOIN public.servidores s ON s.id = p.servidor_id
     WHERE p.ult_falha IS NOT NULL
       AND (p.ult_ok IS NULL OR p.ult_ok < p.ult_falha)
       AND p.ult_falha > now() - interval '30 days'
       AND p.ult_falha >= COALESCE(s.updated_at, '-infinity'::timestamptz)
       AND p.ult_falha >= COALESCE(
             (SELECT max(sb.created_at) FROM public.dispositivos_rep_substituicoes sb
               WHERE sb.dispositivo_id = p.dispositivo_id), '-infinity'::timestamptz)
       AND NOT public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id);

    IF v_legitimos_perdidos > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % recusa(s) legitima(s) deixaram de reprovar - a funcao afrouxou demais.', v_legitimos_perdidos;
    END IF;

    RAISE NOTICE 'fn_cadastro_rep_reprovado: conferencia ok (0 reprovacoes indevidas, 0 recusas legitimas perdidas).';
END
$conf$;


-- ============================================================================
-- CONFERENCIA MANUAL (rodar depois de aplicar)
-- ============================================================================
-- 1. Quem deixou de ser reprovado, com nome:
--
--    SELECT d.nome AS relogio, s.nome AS servidor, s.matricula
--      FROM (SELECT DISTINCT dispositivo_id, servidor_id FROM public.rep_cadastros_fila
--             WHERE status = 'falhou') p
--      JOIN public.dispositivos_rep d ON d.id = p.dispositivo_id
--      JOIN public.servidores       s ON s.id = p.servidor_id
--     WHERE NOT public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id);
--
-- 2. O caso que motivou (deve virar false):
--
--    SELECT public.fn_cadastro_rep_reprovado(
--             (SELECT id FROM public.dispositivos_rep WHERE nome = 'REP iDClass - Almox-Pat-CAF-02'),
--             (SELECT id FROM public.servidores WHERE matricula = '65879'));
--
-- 3. Reenfileirar de fato (o botao "Sincronizar cadastros" da tela faz o mesmo):
--
--    SELECT public.fn_enfileirar_cadastros_rep(
--             (SELECT id FROM public.dispositivos_rep WHERE nome = 'REP iDClass - Almox-Pat-CAF-02'));
`

let out = cabecalho + fn + rodape
if (CRLF) out = out.replace(/\n/g, '\r\n')
fs.writeFileSync(SAIDA, out)
console.log('gerado:', SAIDA)
console.log('  linhas:', out.split(/\r?\n/).length, '| CRLF:', CRLF)
