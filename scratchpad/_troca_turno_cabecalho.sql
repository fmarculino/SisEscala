-- ============================================================================
-- TROCAR O TURNO DE UM DIA COM PONTO ERA IMPOSSIVEL NA LINHA REGULAR (10/09/2026)
-- ============================================================================
-- SINTOMA, relatado do campo: o coordenador lancou MT onde era M, o dia ja tinha ponto, a grade
-- abriu o modal de justificativa (correto), ele escreveu o motivo, clicou em "Alterar e
-- justificar" e recebeu
--
--     new row for relation "justificativas_eventos" violates check constraint
--     "justificativas_eventos_categoria_check"
--
-- A troca NAO acontecia. Nada ficou pela metade — a RPC e um statement so, entao o UPDATE do
-- turno e a linha do historico voltaram atras junto —, mas o coordenador ficava sem saida: a
-- celula nao aceita a correcao por nenhum outro caminho (trg_registrar_troca_turno recusa troca
-- de turno em dia com ponto sem justificativa, e so esta RPC sabe carregar o texto).
--
-- CAUSA
--   fn_alterar_turno_escala_diaria (20260821110000) grava o carimbo da troca em DOIS lugares:
--     1. escala_diaria_turno_historico  — append-only, pela trigger, para QUALQUER categoria;
--     2. justificativas_eventos         — o que o relatorio de justificativas imprime.
--
--   O segundo so existe para EVENTO. A tabela tem
--
--       CHECK (categoria = ANY (ARRAY['Extra', 'Plantao', 'Sobreaviso']))
--
--   e o modulo inteiro e' "Gestao e registro motivacional individual para Horas Extras, Plantoes
--   e Sobreavisos": fn_listar_eventos_justificaveis e as telas filtram exatamente essas tres
--   categorias. A RPC escrevia p_categoria cru, entao para 'Regular' morria em 23514.
--
--   ⚠️ A CHECK NAO ESTA EM MIGRATION NENHUMA — a tabela nasceu fora do versionamento e o
--   CREATE TABLE IF NOT EXISTS de 20260805000000 nunca chegou a cria-la (armadilha 2 do
--   CLAUDE.md). Confirmada por pg_get_constraintdef em 10/09/2026.
--
-- A CORRECAO NAO E' AFROUXAR A CHECK, e essa foi a primeira ideia.
--   Uma linha 'Regular' em justificativas_eventos nao apareceria em tela nenhuma (os tres
--   caminhos de leitura do modulo filtram Extra/Plantao/Sobreaviso), nao sairia em relatorio
--   nenhum, e ainda ocuparia a chave uq_justificativa_evento (servidor, dia, mes, ano,
--   categoria). Seria dado morto criado para satisfazer um INSERT. A CHECK esta CERTA: ela e' o
--   banco dizendo que Regular nao e' evento.
--
--   O motivo da troca continua registrado onde ele sempre foi a prova do ato: o historico
--   append-only escala_diaria_turno_historico, escrito pela trigger para toda categoria, com
--   de -> para, autor e tinha_ponto.
--
-- ⚠️ E O RELATO TEM QUE ACOMPANHAR (armadilha 22). A RPC passa a devolver
--   `justificativa_evento_registrada`, e a grade deixa de prometer "sai no relatorio de Regular"
--   — relatorio que nao existe. Prometer o que o sistema nao faz ensina a desconfiar do resto.
--
-- IDEMPOTENTE: so CREATE OR REPLACE, sem DROP e sem mudanca de assinatura na RPC — ela nao vira
-- objeto novo, entao o GRANT existente e' preservado (armadilha 41).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Fonte unica: esta categoria tem justificativa de EVENTO?
-- ----------------------------------------------------------------------------
-- ESPELHO EXATO de justificativas_eventos_categoria_check. Nao normaliza acento nem caixa DE
-- PROPOSITO: aceitar 'plantao' aqui so adiantaria o INSERT ate a CHECK, que e' literal — trocaria
-- um "nao escreve" explicito pelo mesmo 23514 de antes. Quem chama passa a categoria vinda do
-- enum escala_categoria, que ja e' exata.
--
-- A conferencia no fim desta migration EXECUTA a expressao real da CHECK e aborta se as duas
-- discordarem: se um dia a lista da tabela mudar, isto para de compilar a verdade em silencio.
CREATE OR REPLACE FUNCTION public.fn_categoria_tem_justificativa_evento(p_categoria text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fncat$
    SELECT p_categoria IS NOT NULL
       AND p_categoria = ANY (ARRAY['Extra', 'Plantão', 'Sobreaviso']);
$fncat$;

COMMENT ON FUNCTION public.fn_categoria_tem_justificativa_evento(text) IS
    'Espelho da CHECK justificativas_eventos_categoria_check. Regular NAO e evento: nao tem '
    'justificativa de evento, nao entra no relatorio de justificativas e nao pode ser gravada '
    'naquela tabela. Quem registra a troca de turno de um dia Regular e o historico append-only '
    'escala_diaria_turno_historico.';

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. E' chamada de dentro de
-- fn_alterar_turno_escala_diaria, que e SECURITY INVOKER — authenticated precisa manter o EXECUTE.
REVOKE ALL ON FUNCTION public.fn_categoria_tem_justificativa_evento(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_categoria_tem_justificativa_evento(text)
    TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. fn_alterar_turno_escala_diaria  (base: 20260821110000, copia mecanica)
-- ----------------------------------------------------------------------------
