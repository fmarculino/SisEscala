/**
 * Gera 20260812130000. Copia mecanicamente fn_blocos_previstos_dia de 20260809000000 (a versao
 * vigente) e insere a checagem de escopo por escala_mensal. Aborta em qualquer divergencia
 * (CLAUDE.md, armadilha 1).
 *
 * Pendencia que isto fecha (CLAUDE.md, "Pendencias que bloqueiam a Fase 5", item 3):
 * fn_blocos_previstos_dia e SECURITY DEFINER com GRANT para authenticated e nunca validou
 * acesso ao setor/unidade do servidor consultado. A checagem entra so aqui: por ser envelope
 * LATERAL desta funcao, fn_blocos_previstos_mes -> fn_alocar_marcacoes_dia ->
 * fn_projecao_marcacoes_dia -> fn_conferir_reconciliacao herdam a protecao sem guard proprio.
 * service_role (auth.uid() IS NULL - toda chamada administrativa/manual da cadeia de
 * reconciliacao, incluindo fn_reconciliar_marcacoes_dia, a unica que escreve) continua liberado.
 */
const fs = require('fs')
const BASE = 'c:/Users/SMS-NTI/Projetos/sisescala/supabase/migrations/'
const src = fs.readFileSync(BASE + '20260809000000_night_double_shift_anchor_and_transition_punch.sql', 'utf8').replace(/\r\n/g, '\n')

const i = src.indexOf('CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia')
if (i < 0) throw new Error('ABORTA: nao achei fn_blocos_previstos_dia')
const fimMarcador = '\n$fnbloco$;'
const fim = src.indexOf(fimMarcador, i)
if (fim < 0) throw new Error('ABORTA: nao achei o fechamento $fnbloco$;')
let fn = src.slice(i, fim + fimMarcador.length)

const conta = (t, x) => t.split(x).length - 1
const trocar = (de, para, rotulo) => {
  const n = conta(fn, de)
  if (n !== 1) throw new Error(`ABORTA: "${rotulo}" achado ${n}x (esperado 1)`)
  fn = fn.split(de).join(para)
}

// Escopo entra logo apos v_ano ser resolvido - as tres variaveis (servidor_id, mes, ano) que a
// checagem usa ja estao preenchidas, e ainda nao entrou em nenhum custo real (cursor, LOOP).
trocar(
  '    v_ano         := extract(year  from p_data)::integer;',
`    v_ano         := extract(year  from p_data)::integer;

    -- ESCOPO (12/08/2026, CLAUDE.md "Pendencias que bloqueiam a Fase 5", item 3). Antes desta
    -- checagem, qualquer authenticated podia consultar a projecao de presenca de QUALQUER
    -- servidor, sabendo so o UUID - GRANT liberado, nenhum guard.
    --
    -- service_role bypassa (auth.uid() IS NULL): e o caminho de toda chamada administrativa/
    -- manual da cadeia de reconciliacao (fn_alocar_marcacoes_dia, fn_projecao_marcacoes_dia,
    -- fn_conferir_reconciliacao, fn_reconciliar_marcacoes_dia - a unica que escreve). Nenhuma
    -- delas ganha guard proprio: por serem envelopes LATERAL desta funcao, herdam a checagem
    -- daqui.
    --
    -- Checa por ESCALA (escala_mensal do servidor no mes/ano consultado), NAO pela lotacao
    -- atual (servidores.unidade_id/setor_id): um servidor externo adicionado a escala de outra
    -- unidade (v1.2.4) tem que continuar visivel para quem gerencia AQUELA escala, mesmo fora
    -- da propria lotacao. fn_unidade_no_escopo sozinha nao basta - so verifica
    -- profile_unidades; fn_unidade_alcancavel_por_setor cobre quem so tem profile_setores sem a
    -- unidade-pai vinculada (piloto da TI, ver CLAUDE.md).
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM public.escala_mensal em_escopo
         WHERE em_escopo.servidor_id = p_servidor_id
           AND em_escopo.ano = v_ano
           AND em_escopo.mes = v_mes
           AND (
               public.fn_unidade_no_escopo(em_escopo.unidade_id)
               OR public.fn_unidade_alcancavel_por_setor(em_escopo.unidade_id)
           )
    ) THEN
        RAISE EXCEPTION 'Sem permissão para acessar a escala deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;`,
  'v_ano + insercao do guard de escopo')

if (conta(fn, '$fnbloco$') !== 2) throw new Error('ABORTA: $fnbloco$ desbalanceado: ' + conta(fn, '$fnbloco$'))
if (conta(fn, 'CREATE OR REPLACE FUNCTION') !== 1) throw new Error('ABORTA: CREATE duplicado')
for (const g of [
  'v_servidor_id := p_servidor_id;',
  'INICIO DA REGIAO COPIADA DE 20260807050000',
  'GUARD RESTAURADO (regressao de 20260804080000). NAO REMOVER.',
  'NAO FUNDE com nenhum outro bloco',
  "v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'",
]) {
  if (!fn.includes(g)) throw new Error(`ABORTA: guard/marcador "${g}" sumiu`)
}
if (conta(fn, 'IF auth.uid() IS NOT NULL AND NOT EXISTS') !== 1) throw new Error('ABORTA: guard de escopo nao entrou 1x')

const saida = `-- Migration: Guard de escopo em fn_blocos_previstos_dia (Fase 5, pendencia 3)
-- Data: 2026-08-12
--
-- ARQUIVO GERADO. Nao editar a mao. Regerado por scratchpad/gen_escopo_blocos.js, que copia o
-- corpo vigente de fn_blocos_previstos_dia (20260809000000) e insere so a checagem de escopo,
-- abortando se qualquer contagem de guard/marcador divergir (CLAUDE.md, armadilha 1).
--
-- fonte: 20260809000000 (a versao vigente na data desta migration)
--
--
-- O QUE ESTAVA ABERTO
--   fn_blocos_previstos_dia e SECURITY DEFINER com GRANT EXECUTE para 'authenticated' (desde
--   20260808040000) e NUNCA validou se quem chama tem acesso ao servidor consultado - so pedia
--   p_servidor_id e p_data. Um usuario autenticado (coordenador, rh_unidade, etc.) podia
--   consultar a projecao de presenca de qualquer servidor da base, de qualquer unidade, sabendo
--   so o UUID. Registrado como pendencia 3 de "Pendencias que bloqueiam a Fase 5" no CLAUDE.md.
--
--   fn_blocos_previstos_mes (a que a grade chama de verdade), fn_alocar_marcacoes_dia,
--   fn_projecao_marcacoes_dia e fn_conferir_reconciliacao tem a MESMA exposicao, mas nenhuma
--   delas precisa de guard proprio: todas sao, por construcao, envelopes LATERAL desta funcao
--   (fn_blocos_previstos_mes ja documenta isso na propria migration, 20260808120000, como
--   pendencia deliberadamente adiada "para nao misturar mudanca de seguranca com mudanca de
--   comportamento na mesma migration"). Fechar aqui fecha a cadeia inteira.
--
--
-- POR QUE POR ESCALA, NAO POR LOTACAO
--   A tentacao obvia seria checar servidores.unidade_id/setor_id (a lotacao atual). Errado: um
--   servidor externo adicionado a escala de outra unidade (v1.2.4, "Selecao de Servidor
--   Externo") tem que continuar visivel para quem gerencia AQUELA escala, mesmo fora da propria
--   lotacao - e e exatamente esse o caso de uso da feature. A escala_mensal do servidor naquele
--   mes/ano ja carrega o unidade_id/setor_id corretos para quem deveria poder ver, servidor
--   externo ou nao. Checar por ela em vez da lotacao cobre os dois casos sem distinguir.
--
--   fn_unidade_no_escopo sozinha nao basta - verifica so profile_unidades. Um coordenador cujo
--   acesso vem inteiramente de profile_setores (setor vinculado sem a unidade-pai vinculada
--   tambem, caso real do piloto da TI, ja documentado no CLAUDE.md a proposito de
--   fn_unidade_no_escopo) perderia acesso legitimo. fn_unidade_alcancavel_por_setor
--   (20260812050000, ja usada para a mesma lacuna em importacao_rh_pendentes) cobre esse caso.
--
--
-- POR QUE service_role BYPASSA (auth.uid() IS NULL)
--   Nao ha, hoje, nenhum caller de aplicacao para fn_alocar_marcacoes_dia, fn_projecao_
--   marcacoes_dia, fn_conferir_reconciliacao ou fn_reconciliar_marcacoes_dia (grep em src/ nao
--   acha nenhum) - a cadeia de reconciliacao so e chamada manualmente hoje (SQL direto, service
--   role key), o que roda sem sessao de usuario e portanto sem auth.uid(). Bloquear esse
--   caminho pararia a unica forma de operar a reconciliacao hoje. fn_reconciliar_marcacoes_dia
--   ja e service_role apenas (grant restrito desde 20260808060000); nada muda ali.
--
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao toca fn_blocos_previstos_mes, fn_alocar_marcacoes_dia, fn_projecao_marcacoes_dia,
--   fn_conferir_reconciliacao nem fn_reconciliar_marcacoes_dia - todas herdam a checagem por
--   chamarem fn_blocos_previstos_dia. Nao altera fn_unidade_no_escopo (CLAUDE.md ja registra a
--   lacuna dela sobre profile_setores como pendencia separada, deliberadamente nao mexida por
--   afetar mais coisa do que o necessario aqui).
--
--
-- CONFERENCIA APOS APLICAR
--
--   1. A grade (ScaleGrid -> fn_blocos_previstos_mes) continua funcionando para quem tem
--      escopo - nenhuma sessao real deveria ver diferenca nenhuma. Testar abrindo a grade de
--      uma unidade normal como coordenador dela.
--
--   2. Uma chamada direta por RPC para um servidor FORA do escopo do usuario logado tem que
--      falhar agora (antes devolvia a projecao normalmente):
--
--      SELECT * FROM public.fn_blocos_previstos_dia(
--          '<uuid de um servidor de outra unidade>', CURRENT_DATE);
--      -- esperado: ERRO "Sem permissao para acessar a escala deste servidor."
--
--   3. Chamada via service_role (SQL Editor / script com a service role key) continua sem
--      restricao nenhuma - auth.uid() e NULL nesse caminho:
--
--      SELECT * FROM public.fn_blocos_previstos_dia(
--          (SELECT id FROM public.servidores LIMIT 1), CURRENT_DATE);
--      -- esperado: funciona igual a antes.
--
--   4. Servidor externo continua visivel para quem gerencia a escala que o recebeu, mesmo fora
--      da propria lotacao (o caso que motivou checar por escala_mensal, nao por lotacao):
--
--      -- como o coordenador que gerencia a escala ONDE o servidor externo esta escalado:
--      SELECT * FROM public.fn_blocos_previstos_dia(
--          '<uuid do servidor externo>', '<uma data com escala nesta unidade>');
--      -- esperado: funciona normalmente.


${fn}
`

const destino = BASE + '20260812130000_scope_guard_blocos_previstos_dia.sql'
fs.writeFileSync(destino, saida.replace(/\n/g, '\r\n'))
console.log('gerado:', destino)
console.log('  $fnbloco$ =', conta(saida, '$fnbloco$'), '(par, esperado 2)')
console.log('  CREATE OR REPLACE FUNCTION =', conta(saida, 'CREATE OR REPLACE FUNCTION'), '(esperado 1)')
console.log('  guard de escopo citado =', conta(saida, 'IF auth.uid() IS NOT NULL AND NOT EXISTS'), 'vez(es)')
