-- ============================================================================
-- Migration: o intervalo do plantao deixa de ser herdado da jornada Regular
-- Data: 2026-08-22
--
-- O PROBLEMA, MEDIDO EM PRODUCAO EM 22/08/2026
--   fn_jornada_tem_intervalo(duracao, intervalo_minutos) recebia os dois argumentos de
--   fontes DIFERENTES, e so um deles tinha sido corrigido para plantao:
--     - duracao          : do TURNO quando a categoria nao e Regular (horas_computadas). Certo.
--     - intervalo_minutos: SEMPRE de jornadas.intervalo_minutos, a jornada REGULAR do servidor.
--
--   Toda jornada de ate 6h tem intervalo_minutos = 0 no cadastro (correto para o expediente
--   dela), e esse zero ANULAVA O GUARD INTEIRO, qualquer que fosse a duracao do plantao.
--
--   Caso real (22/08/2026, mesmo sabado, mesmo turno MT de 12h):
--     AGNES  (jornada 08H AS 18H, 10h, intervalo 120) -> bloco 08:00-20:00, intervalo 12:00-14:00
--     INGRID (jornada 07H AS 13H,  6h, intervalo   0) -> bloco 07:00-19:00, SEM intervalo
--
--   E o prejuizo ja tinha acontecido, com batida assinada do relogio:
--     INGRID (HMI)   : batida REP das 14:41 gravada como SAIDA de um plantao que vai ate 19:00
--     GISELE (LACEM) : batida REP das 13:00 gravada como SAIDA de um plantao que vai ate 19:00
--   Nao havia passo de intervalo para elas cairem; a alocacao pos no unico passo que sobrava.
--   Nenhuma tentativa recusada foi gerada -> silencioso dos dois lados.
--
--   Alcance medido (06-08/2026, Plantao/Extra > 6h em unidade que marca intervalo, 380 linhas):
--     106 com 0 min  (jornadas de 4h e 6h)  -> nenhum intervalo previsto
--     206 com 60 min
--      68 com 120 min (jornadas de 10h)     -> o expediente vazando para dentro do plantao
--
-- A BASE LEGAL
--   Lei 17.331/2008 (Regime Juridico Unico dos servidores de Maraba), Art. 17:
--     Par. 2  "Regulamento disciplinara a jornada de trabalho dos titulares de cargos de
--              provimento efetivo cujo exercicio exija REGIME DE TURNO OU PLANTAO."
--
--   O proprio estatuto separa plantao da jornada comum e manda REGULAMENTO PROPRIO discipliná-lo.
--   Esse regulamento nao existe hoje -> o parametro aplicavel subsidiariamente e a CLT Art. 71,
--   que e o fundamento que fn_jornada_tem_intervalo ja citava:
--
--     caput   "Em qualquer trabalho continuo, cuja duracao EXCEDA DE 6 (SEIS) HORAS, e obrigatoria
--              a concessao de um intervalo [...] no minimo, de 1 (uma) hora e, salvo acordo escrito
--              ou contrato coletivo em contrario, nao podera exceder de 2 (duas) horas."
--
--   A ancora do caput e "TRABALHO CONTINUO, CUJA DURACAO EXCEDA" - a duracao do que foi
--   trabalhado, nao o contrato de quem trabalhou. Um plantao de 12h e trabalho continuo de 12h,
--   seja de quem for. Art. 59-A (12x36) confirma: o intervalo e observado OU indenizado.
--
-- A FRONTEIRA E DECISAO DO USUARIO (22/08/2026), E E EXATAMENTE ESTA
--   "Jornadas de ate 6h NAO tem intervalo de ponto: registra so entrada e saida. So vai ter
--    intervalo jornada MAIOR que 6h."
--
--   Por isso a faixa de 15 minutos do Art. 71 par. 1 (trabalho acima de 4h e ate 6h) NAO entra
--   aqui, nem sequer codificada de forma inerte. O piso legal deste sistema tem duas faixas:
--   acima de 360 min -> 60 min; senao -> 0. Isso preserva sem nenhuma mudanca o comportamento
--   atual de fn_jornada_tem_intervalo (duracao > 360) para todo o expediente Regular.
--
-- O QUE ESTA MIGRATION CRIA (as funcoes de presenca sao recriadas na migration seguinte)
--   1. dicionario_turnos.intervalo_minutos - o intervalo do PLANTAO, por codigo de turno. E o
--      lugar onde o numero do futuro regulamento do Par. 2 vai morar. Fica NULL de proposito:
--      NULL = "ainda nao regulamentado, use o piso legal".
--   2. fn_intervalo_minimo_legal(duracao)   - o piso do Art. 71 caput traduzido em codigo.
--   3. fn_intervalo_previsto_minutos(...)   - fonte unica da resolucao. Regular olha a jornada,
--      Plantao/Extra olha o turno, e NENHUM DOS DOIS pode cair abaixo do piso legal.
--
-- POR QUE O PISO, E NAO SO A COLUNA NOVA
--   So a coluna dependeria de alguem cadastrar corretamente os 53 codigos de plantao. Um codigo
--   esquecido voltaria a ser o bug de hoje, em silencio. O piso derivado da duracao torna a regra
--   impossivel de esquecer - mesma filosofia de fn_jornada_tem_intervalo.
--
-- EFEITO DA REGRA SOBRE OS 380 LANCAMENTOS MEDIDOS
--   106 de   0 min -> 60 min  (piso legal do caput; corrige Ingrid, Gisele e os demais)
--   206 de  60 min -> 60 min  (inalterado)
--    68 de 120 min -> 60 min  (o expediente para de vazar para dentro do plantao)
--
--   Os dois riscos de mexer nos 68 foram medidos e estao vazios:
--     - servidores.intervalo_flexivel = true em 0 de 500 servidores, entao
--       fn_ajuste_intervalo_flexivel esta INERTE e encurtar o intervalo previsto nao antecipa
--       a saida esperada de ninguem;
--     - so 6 dos 68 tem batida de intervalo gravada, e o maior intervalo REALMENTE PRATICADO
--       foi de 94 minutos - nenhum encostou nos 120.
--   Se o RH decidir que o MT merece 2h, agora isso se cadastra UMA VEZ no codigo MT, valendo
--   para todo mundo, em vez de depender do expediente de cada servidor.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   - Nao altera horas pagas. horas_computadas e decomporPlantao (unidades PL) nao descontam
--     intervalo; ninguem perde PL12 por causa disto.
--   - Nao toca na folha de ponto, que le so Regular e Extra.
--   - Nao muda NADA para jornada Regular de ate 6h: continua entrada e saida, so.
--   - Nao reprocessa nada. O intervalo previsto e derivado em runtime por fn_blocos_previstos_dia,
--     entao recriar as funcoes ja corrige a previsao de todo mes. As linhas de agosto/2026 cuja
--     batida real ja foi alocada errada precisam de fn_reconciliar_marcacoes_dia DIA A DIA,
--     nunca em massa - ver a consulta de conferencia no fim deste arquivo.
-- ============================================================================


-- ============================================================================
-- 1. dicionario_turnos.intervalo_minutos - o intervalo do plantao, por codigo
-- ============================================================================

ALTER TABLE public.dicionario_turnos
    ADD COLUMN IF NOT EXISTS intervalo_minutos integer;

ALTER TABLE public.dicionario_turnos
    DROP CONSTRAINT IF EXISTS chk_dicionario_turnos_intervalo_minutos;

ALTER TABLE public.dicionario_turnos
    ADD CONSTRAINT chk_dicionario_turnos_intervalo_minutos
    CHECK (intervalo_minutos IS NULL OR intervalo_minutos >= 0);

COMMENT ON COLUMN public.dicionario_turnos.intervalo_minutos IS
    'Intervalo intrajornada do turno, em minutos. NULL = nao regulamentado: vale o piso legal de '
    'public.fn_intervalo_minimo_legal. E o lugar do numero que o regulamento previsto no Art. 17, '
    'par. 2 da Lei 17.331/2008 (RJU de Maraba) vier a fixar para o regime de turno ou plantao. '
    'NAO confundir com jornadas.intervalo_minutos, que e o intervalo do expediente Regular do '
    'servidor - foi justamente heranca indevida daquele campo que suprimiu o intervalo de 106 '
    'plantoes de mais de 6h ate 22/08/2026.';


-- ============================================================================
-- 2. FONTE UNICA DO PISO LEGAL (CLT Art. 71, caput)
--
-- NAO REPLICAR ESTA TABELA EM LUGAR NENHUM. O espelho do frontend vive em
-- src/utils/intervaloIntrajornada.ts e existe so porque a grade desenha os segmentos
-- antes de chamar o banco.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_intervalo_minimo_legal(
    p_duracao_minutos integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
    -- CLT Art. 71, caput: trabalho continuo ACIMA de 6h (360 min) -> minimo de 1 hora.
    -- Ate 6h            : nenhum intervalo. Decisao do usuario em 22/08/2026 - jornada de ate
    --                     6h registra so entrada e saida. A faixa de 15 min do Art. 71 par. 1
    --                     NAO e implementada aqui de proposito; ver o cabecalho da migration.
    --
    -- A fronteira em 360 min e a MESMA de fn_jornada_tem_intervalo, e as duas precisam
    -- continuar concordando: um piso que devolvesse valor numa faixa que o guard recusa
    -- (ou o contrario) faria o terminal aceitar uma janela que a reconciliacao nao preve.
    SELECT CASE
        WHEN COALESCE(p_duracao_minutos, 0) > 360 THEN 60
        ELSE 0
    END;
$fn$;

COMMENT ON FUNCTION public.fn_intervalo_minimo_legal(integer) IS
    'Piso legal do intervalo intrajornada, em minutos, derivado da DURACAO DO TRABALHO CONTINUO '
    '(CLT Art. 71, caput): duracao > 360 min -> 60; senao 0. E piso, nunca teto - o cadastro pode '
    'elevar (o caput admite ate 2h), nunca rebaixar. A fronteira de 360 min acompanha '
    'fn_jornada_tem_intervalo por decisao do usuario em 22/08/2026: jornada de ate 6h registra '
    'so entrada e saida.';


-- ============================================================================
-- 3. FONTE UNICA DA RESOLUCAO: qual cadastro vale, e o piso que nenhum deles fura
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_intervalo_previsto_minutos(
    p_categoria         text,
    p_duracao_minutos   integer,
    p_jornada_intervalo integer,
    p_turno_intervalo   integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
    -- Regular       : o intervalo e propriedade do EXPEDIENTE -> jornadas.intervalo_minutos.
    --                 O default 60 preserva exatamente o COALESCE(j.intervalo_minutos, 60) que
    --                 os cursores usavam quando o LEFT JOIN de jornadas nao casa.
    -- Plantao/Extra : o intervalo e propriedade do TURNO -> dicionario_turnos.intervalo_minutos.
    --                 Default 0 (e nao 60) porque o piso legal abaixo ja garante o minimo pela
    --                 duracao; um default de 60 daria intervalo a turno curto que nao tem direito.
    --
    -- GREATEST com o piso: e o que impede tanto o zero da jornada de 6h (que suprimia o intervalo
    -- de plantao de 12h) quanto um cadastro futuro abaixo do minimo legal.
    SELECT GREATEST(
        CASE WHEN p_categoria = 'Regular'
             THEN COALESCE(p_jornada_intervalo, 60)
             ELSE COALESCE(p_turno_intervalo, 0)
        END,
        public.fn_intervalo_minimo_legal(p_duracao_minutos)
    );
$fn$;

COMMENT ON FUNCTION public.fn_intervalo_previsto_minutos(text, integer, integer, integer) IS
    'Fonte unica do intervalo previsto de um turno. Regular le jornadas.intervalo_minutos; '
    'Plantao/Extra le dicionario_turnos.intervalo_minutos; os dois passam por GREATEST com '
    'fn_intervalo_minimo_legal(duracao). Substitui o COALESCE(j.intervalo_minutos, 60) que os '
    'cursores de fn_confirmar_presenca, fn_confirmar_presenca_manual e fn_blocos_previstos_dia '
    'aplicavam a QUALQUER categoria - a heranca que suprimia o intervalo do plantao.';


GRANT EXECUTE ON FUNCTION public.fn_intervalo_minimo_legal(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_intervalo_previsto_minutos(text, integer, integer, integer) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar as DUAS migrations)
--
-- 1. Nenhum plantao/extra acima de 6h em unidade que marca intervalo pode continuar sem
--    janela de intervalo. Esperado: 0 linhas.
--
--    SELECT s.nome, ed.dia, dt.codigo, b.inicio_previsto, b.fim_previsto, b.permite_intervalo
--      FROM public.escala_diaria ed
--      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--      JOIN public.servidores s     ON s.id = em.servidor_id
--      JOIN public.unidades u       ON u.id = em.unidade_id
--      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--      CROSS JOIN LATERAL public.fn_blocos_previstos_dia(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia)) b
--     WHERE ed.categoria IN ('Plantão', 'Extra')
--       AND dt.horas_computadas > 6
--       AND COALESCE(u.permite_marca_intervalo, false)
--       AND em.ano = 2026 AND em.mes = 8
--       AND ed.id = ANY(b.escala_diaria_ids)
--       AND NOT b.permite_intervalo;
--
-- 2. Nenhuma jornada Regular de ate 6h pode ter ganhado passo de intervalo (decisao do usuario
--    em 22/08/2026). Esperado: 0 linhas.
--
--    SELECT s.nome, ed.dia, j.nome AS jornada, b.permite_intervalo
--      FROM public.escala_diaria ed
--      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--      JOIN public.servidores s     ON s.id = em.servidor_id
--      JOIN public.jornadas j       ON j.id = em.jornada_id
--      CROSS JOIN LATERAL public.fn_blocos_previstos_dia(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia)) b
--     WHERE ed.categoria = 'Regular'
--       AND j.horas_totais <= 6
--       AND em.ano = 2026 AND em.mes = 8
--       AND ed.id = ANY(b.escala_diaria_ids)
--       AND b.permite_intervalo;
--
-- 3. As linhas de agosto/2026 cuja batida REAL foi para o passo errado por falta do passo de
--    intervalo. NAO reconciliar em massa - a projecao nem sempre e melhor que o que esta
--    gravado. Levar caso a caso ao coordenador da unidade e so entao rodar
--    fn_reconciliar_marcacoes_dia(servidor, dia) para o par escolhido.
--
--    SELECT s.nome, ed.dia, dt.codigo, ed.presenca_entrada_em, ed.presenca_saida_em,
--           ed.presenca_saida_origem
--      FROM public.escala_diaria ed
--      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--      JOIN public.servidores s     ON s.id = em.servidor_id
--      JOIN public.unidades u       ON u.id = em.unidade_id
--      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--      JOIN public.jornadas j       ON j.id = em.jornada_id
--     WHERE ed.categoria IN ('Plantão', 'Extra')
--       AND dt.horas_computadas > 6
--       AND COALESCE(u.permite_marca_intervalo, false)
--       AND COALESCE(j.intervalo_minutos, 60) = 0
--       AND em.ano = 2026 AND em.mes = 8
--       AND ed.presenca_saida_origem IN ('rep', 'terminal')
--     ORDER BY ed.dia, s.nome;
-- ============================================================================
