// Gera a migration que impede o reenfileiramento de cadastro ja RECUSADO pelo equipamento.
// Copia MECANICA das duas funcoes vigentes, que vivem em migrations DIFERENTES:
//   fn_enfileirar_cadastros_rep        -> 20260822200000
//   fn_enfileirar_cadastros_por_escala -> 20260817100000
// Aborta se qualquer substituicao nao bater na contagem esperada.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const FONTE_LOTACAO = path.join(RAIZ, 'supabase/migrations/20260822200000_reconciliar_vinculos_com_snapshot_rep.sql')
const FONTE_ESCALA = path.join(RAIZ, 'supabase/migrations/20260817100000_allow_coordinators_enfileirar_cadastros_rep.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260905110000_fila_rep_nao_reenfileira_recusado.sql')

const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

function trocar(texto, de, para, esperado, rotulo) {
  const achou = texto.split(de).length - 1
  if (achou !== esperado) {
    console.error('ABORTADO: "' + rotulo + '" esperava ' + esperado + ', achou ' + achou)
    process.exit(1)
  }
  return texto.split(de).join(para)
}

function extrair(arquivo, assinatura) {
  const src = fs.readFileSync(arquivo, 'utf8')
  const i = src.indexOf(assinatura)
  if (i < 0) {
    console.error('ABORTADO: nao achei ' + assinatura + ' em ' + path.basename(arquivo))
    process.exit(1)
  }
  const FIM = '$fn$;'
  return src.slice(i, src.indexOf(FIM, i) + FIM.length)
}

let fnLotacao = extrair(FONTE_LOTACAO, 'CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(')
let fnEscala = extrair(FONTE_ESCALA, 'CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_por_escala(')

// ------------------------------------------------------------------ o guard, nos dois INSERTs
const GUARD = crlf([
  '',
  '           -- Nao insistir com quem o EQUIPAMENTO ja recusou. Ver fn_cadastro_rep_reprovado.',
  '           AND NOT public.fn_cadastro_rep_reprovado(p_dispositivo_id, ',
].join('\n'))

fnLotacao = trocar(
  fnLotacao,
  crlf([
    '           AND NOT EXISTS (',
    "                 SELECT 1 FROM public.rep_cadastros_fila f",
    "                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')",
  ].join('\n')),
  crlf([
    '           AND NOT EXISTS (',
    '                 SELECT 1 FROM public.rep_cadastros_fila f',
    "                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')",
    '           -- Nao insistir com quem o EQUIPAMENTO ja recusou (ver fn_cadastro_rep_reprovado).',
    '           AND NOT public.fn_cadastro_rep_reprovado(p_dispositivo_id, c.id)',
  ].join('\n')),
  1,
  'guard no INSERT por lotacao'
)

fnEscala = trocar(
  fnEscala,
  crlf([
    '         WHERE NOT EXISTS (',
    '             SELECT 1 FROM public.rep_cadastros_fila f',
    '              WHERE f.dispositivo_id = p_dispositivo_id',
    '                AND f.servidor_id = a.servidor_id',
    "                AND f.status = 'pendente'",
    '         )',
  ].join('\n')),
  crlf([
    '         WHERE NOT EXISTS (',
    '             SELECT 1 FROM public.rep_cadastros_fila f',
    '              WHERE f.dispositivo_id = p_dispositivo_id',
    '                AND f.servidor_id = a.servidor_id',
    "                AND f.status = 'pendente'",
    '         )',
    '           -- Nao insistir com quem o EQUIPAMENTO ja recusou (ver fn_cadastro_rep_reprovado).',
    '           AND NOT public.fn_cadastro_rep_reprovado(p_dispositivo_id, a.servidor_id)',
  ].join('\n')),
  1,
  'guard no INSERT por escala'
)

// ------------------------------------------------------------------ montagem
const CAB = crlf(`-- ============================================================================
-- A fila de cadastro para de insistir com quem o EQUIPAMENTO recusou (05/09/2026)
-- ============================================================================
--
-- MOTIVACAO (medida em producao em 05/09/2026, com autorizacao do usuario).
-- rep_cadastros_fila tinha 2.463 linhas 'falhou', e o mesmo par (dispositivo, servidor) aparecia
-- ate 83 VEZES. 246 pares tinham mais de uma tentativa, e 25 dos 51 pendentes do momento ja
-- haviam falhado antes NO MESMO relogio. Erros dominantes, todos recusa do equipamento:
--   1443  nenhum formato de add_users.fcgi funcionou neste equipamento
--    657  add_users.fcgi recusou: 'pis' em formato incorreto
--     68  add_users.fcgi recusou: Matricula ja cadastrada
--
-- 'falhou' JA SIGNIFICA DEFINITIVO: fn_confirmar_cadastro_rep so grava esse status quando a falha
-- NAO e transitoria (rede/timeout volta para 'pendente' com tentativas+1). Ou seja, o proprio
-- modelo ja dizia "nao insista" - o que faltava era o enfileiramento respeitar isso.
--
-- O laco vinha dos cliques na tela (326, 403 e 179 falhas/dia em 31/08, 01/09 e 02/09). Virou
-- problema maior ao entrar no cron diario (20260905, /api/cron): o coletor aplica no maximo 20
-- cadastros por ciclo, entao entradas condenadas CONSOMEM a vaga de quem e novo de verdade.
--
-- O CRITERIO NAO E UMA JANELA DE TEMPO ARBITRARIA. Reprova quem falhou e cujo cadastro NAO mudou
-- desde a falha (servidores.updated_at <= processado_em). Corrigir o CPF/PIS da pessoa libera a
-- retentativa NA HORA, que e exatamente a acao que tem chance de mudar o resultado. O teto de 30
-- dias existe so para o caso em que quem mudou foi o OUTRO lado - firmware do equipamento, ou
-- uma versao nova do coletor com formato novo de add_users.fcgi.
--
-- Vale para os DOIS caminhos (lotacao e escala) e para os DOIS chamadores (botao da tela e cron):
-- o laco foi criado pela tela, entao proteger so o cron nao resolveria.
--
-- Gerado por scratchpad/gen_fila_nao_reenfileira.js (copia mecanica de 20260822200000 e
-- 20260817100000 - as duas funcoes vivem em migrations DIFERENTES).
-- Idempotente: CREATE OR REPLACE, sem mudanca de assinatura.


-- ============================================================================
-- 1. O criterio, em um lugar so
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cadastro_rep_reprovado(
    p_dispositivo_id uuid,
    p_servidor_id    uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1
          FROM public.rep_cadastros_fila f
          JOIN public.servidores s ON s.id = f.servidor_id
         WHERE f.dispositivo_id = p_dispositivo_id
           AND f.servidor_id    = p_servidor_id
           AND f.status = 'falhou'
           -- Teto de 30 dias: quem pode ter mudado e o OUTRO lado (firmware, coletor novo com
           -- outro formato de add_users.fcgi). Sem ele, um equipamento consertado nunca voltaria
           -- a receber essas pessoas sem alguem editar cada cadastro na mao.
           AND COALESCE(f.processado_em, f.created_at) > now() - interval '30 days'
           -- O criterio principal: a falha e' mais nova que a ultima alteracao do cadastro, ou
           -- seja NADA mudou do nosso lado desde que o relogio recusou. Corrigir o CPF/PIS da
           -- pessoa move updated_at e libera a retentativa imediatamente.
           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(s.updated_at, '-infinity'::timestamptz)
    );
$fn$;

COMMENT ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) IS
    'true quando o equipamento ja RECUSOU este cadastro e nada mudou desde entao - fonte unica '
    'do "nao insista" usada por fn_enfileirar_cadastros_rep e fn_enfileirar_cadastros_por_escala.';

REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. fn_enfileirar_cadastros_rep (copia mecanica de 20260822200000 + guard)
-- ============================================================================

`)

const MEIO = crlf(`


-- ============================================================================
-- 3. fn_enfileirar_cadastros_por_escala (copia mecanica de 20260817100000 + guard)
-- ============================================================================

`)

const RODAPE = crlf(`


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Quantos pares seriam poupados agora (o tamanho do laco que estava rodando):
--   SELECT count(*) AS reprovados
--     FROM (SELECT DISTINCT dispositivo_id, servidor_id
--             FROM public.rep_cadastros_fila WHERE status = 'falhou') x
--    WHERE public.fn_cadastro_rep_reprovado(x.dispositivo_id, x.servidor_id);
--
-- 2. Enfileirar de novo NAO pode mais crescer sozinho. Rode duas vezes seguidas no mesmo
--    dispositivo: a segunda tem que devolver enfileirados = 0.
--   SELECT public.fn_enfileirar_cadastros_rep('<dispositivo>');
--   SELECT public.fn_enfileirar_cadastros_rep('<dispositivo>');
--
-- 3. Corrigir o cadastro LIBERA a retentativa (e o que impede a regra de virar prisao):
--   UPDATE public.servidores SET updated_at = now() WHERE id = '<servidor que falhou>';
--   SELECT public.fn_cadastro_rep_reprovado('<dispositivo>', '<servidor>');  -- deve virar false
--
-- 4. Ninguem que NUNCA falhou pode ser barrado (o guard so olha status 'falhou'):
--   SELECT count(*) AS deve_ser_zero
--     FROM public.servidores s, public.dispositivos_rep d
--    WHERE public.fn_cadastro_rep_reprovado(d.id, s.id)
--      AND NOT EXISTS (SELECT 1 FROM public.rep_cadastros_fila f
--                       WHERE f.dispositivo_id = d.id AND f.servidor_id = s.id
--                         AND f.status = 'falhou');
`)

const saida = CAB + fnLotacao + MEIO + fnEscala + RODAPE

const conferencias = [
  ['dollar-quoting $fn$ em pares', (saida.match(/\$fn\$/g) || []).length, 6],
  ['as tres funcoes criadas', (saida.match(/CREATE OR REPLACE FUNCTION public\./g) || []).length, 3],
  ['guard aplicado nos dois INSERTs', (saida.match(/AND NOT public\.fn_cadastro_rep_reprovado/g) || []).length, 2],
  ['guard de pendente preservado', (saida.match(/f\.status = 'pendente'/g) || []).length, 2],
  ['checagem de vinculo preservada', (saida.match(/rep_vinculos_servidor/g) || []).length >= 1 ? 1 : 0, 1],
  ['checagem de snapshot preservada', (saida.match(/rep_usuarios_dispositivo/g) || []).length >= 1 ? 1 : 0, 1],
  // Separado por funcao de proposito: um agregado esconderia QUAL das duas perdeu um guard.
  // A de lotacao tem 2 (papel + escopo da unidade); a de escala tem 1 (so papel - o escopo dela
  // vem da propria consulta de escala).
  ['guards da fn_enfileirar_cadastros_rep', (fnLotacao.match(/insufficient_privilege/g) || []).length, 2],
  ['guards da fn_enfileirar_cadastros_por_escala', (fnEscala.match(/insufficient_privilege/g) || []).length, 1],
  ['REVOKE de PUBLIC no criterio novo', (saida.match(/FROM PUBLIC;/g) || []).length, 1],
  ['nenhum DROP', (saida.match(/DROP FUNCTION/g) || []).length, 0],
]
let falhou = false
for (const [rotulo, achou, esperado] of conferencias) {
  const ok = achou === esperado
  if (!ok) falhou = true
  console.log((ok ? 'ok    ' : 'FALHA ') + rotulo + ': ' + achou + ' (esperado ' + esperado + ')')
}
if (falhou) {
  console.error('\nABORTADO: invariante estrutural divergiu')
  process.exit(1)
}

fs.writeFileSync(DESTINO, saida, 'utf8')
console.log('\ngerado: ' + path.relative(RAIZ, DESTINO) + ' (' + saida.length + ' bytes)')
