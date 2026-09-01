/*
 * scratchpad/gen_guarda_intervalo.js
 *
 * Gera a migration 20260901120000_guarda_intervalo_minimo_e_deduplicacao_entrada.sql
 * Copia os corpos vigentes de:
 *   - fn_alocar_marcacoes_dia (de 20260823100000_dono_do_passo_do_bloco.sql)
 *   - fn_confirmar_presenca (de 20260823130000_batida_de_transicao_no_terminal.sql)
 *
 * Aplica:
 *   1. v_slot_piso dos slots de intervalo_saida e intervalo_retorno = r.inicio_previsto + interval '60 minutes'
 *   2. Guarda de 60 minutos para abertura de intervalo flexivel em fn_confirmar_presenca
 *   3. Resposta amigavel 'Entrada ja confirmada' quando bater novamente a menos de 60 min da entrada
 */

const fs = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const SRC_ALOCAR = path.join(MIGRATIONS_DIR, '20260823100000_dono_do_passo_do_bloco.sql')
const SRC_CONFIRMAR = path.join(MIGRATIONS_DIR, '20260823130000_batida_de_transicao_no_terminal.sql')
const OUT_FILE = path.join(MIGRATIONS_DIR, '20260901120000_guarda_intervalo_minimo_e_deduplicacao_entrada.sql')

const contentAlocar = fs.readFileSync(SRC_ALOCAR, 'utf8').replace(/\r\n/g, '\n')
const contentConfirmar = fs.readFileSync(SRC_CONFIRMAR, 'utf8').replace(/\r\n/g, '\n')

// 1. Extrair definicao de fn_alocar_marcacoes_dia
const markerAlocarStart = 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia('
const markerAlocarEnd = '$fnaloc$;'

const idxA1 = contentAlocar.indexOf(markerAlocarStart)
if (idxA1 < 0) throw new Error('fn_alocar_marcacoes_dia nao encontrada em ' + SRC_ALOCAR)
const idxA2 = contentAlocar.indexOf(markerAlocarEnd, idxA1)
if (idxA2 < 0) throw new Error('Fim de fn_alocar_marcacoes_dia nao encontrado')
let fnAlocarSql = contentAlocar.slice(idxA1, idxA2 + markerAlocarEnd.length)

// Ajustar o piso de intervalo em fn_alocar_marcacoes_dia
const targetPisoAntigo = `        IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
            v_slot_passo := v_slot_passo || 'intervalo_saida'::text;
            v_slot_prev  := v_slot_prev  || r.intervalo_inicio_previsto;
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
            v_slot_opcional := v_slot_opcional || false;

            v_slot_passo := v_slot_passo || 'intervalo_retorno'::text;
            v_slot_prev  := v_slot_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
            v_slot_opcional := v_slot_opcional || false;
        END IF;`

const targetPisoNovo = `        IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
            v_slot_passo := v_slot_passo || 'intervalo_saida'::text;
            v_slot_prev  := v_slot_prev  || r.intervalo_inicio_previsto;
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            -- Piso do intervalo: minimo de 60 minutos decorridos desde o inicio previsto
            -- para impedir que batidas matinais proximas a entrada casem com o intervalo.
            v_slot_piso  := v_slot_piso  || (r.inicio_previsto + interval '60 minutes');
            v_slot_opcional := v_slot_opcional || false;

            v_slot_passo := v_slot_passo || 'intervalo_retorno'::text;
            v_slot_prev  := v_slot_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            v_slot_piso  := v_slot_piso  || (r.inicio_previsto + interval '60 minutes');
            v_slot_opcional := v_slot_opcional || false;
        END IF;`

if (!fnAlocarSql.includes(targetPisoAntigo)) {
  throw new Error('Trecho de piso de intervalo nao encontrado em fn_alocar_marcacoes_dia')
}
fnAlocarSql = fnAlocarSql.replace(targetPisoAntigo, targetPisoNovo)

// 2. Extrair definicao de fn_confirmar_presenca
const markerConfStart = 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca('
const markerConfEnd = '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;'

const idxC1 = contentConfirmar.indexOf(markerConfStart)
if (idxC1 < 0) throw new Error('fn_confirmar_presenca nao encontrada em ' + SRC_CONFIRMAR)
const idxC2 = contentConfirmar.indexOf(markerConfEnd, idxC1)
if (idxC2 < 0) throw new Error('Fim de fn_confirmar_presenca nao encontrado')
let fnConfirmarSql = contentConfirmar.slice(idxC1, idxC2 + markerConfEnd.length)

// Ajustar o passo 2 (intervalo flexivel) em fn_confirmar_presenca
const targetIntFlexAntigo = `                   -- Intervalo flexivel: qualquer momento apos a entrada, mas antes de abrir
                   -- a janela de saida final (senao a saida do expediente viraria intervalo).
                   OR (v_intervalo_flexivel
                       AND v_b_entradas[1] IS NOT NULL
                       AND v_momento_atual_minutos > v_b_inicio
                       AND v_momento_atual_minutos < (v_b_fim - v_janela_minutos))`

const targetIntFlexNovo = `                   -- Intervalo flexivel: exige ao menos 60 minutos decorridos de trabalho
                   -- desde a entrada, e antes de abrir a janela de saida final.
                   OR (v_intervalo_flexivel
                       AND v_b_entradas[1] IS NOT NULL
                       AND extract(epoch from (v_now - v_b_entradas[1])) >= 3600
                       AND v_momento_atual_minutos >= (v_b_inicio + 60)
                       AND v_momento_atual_minutos < (v_b_fim - v_janela_minutos))`

if (!fnConfirmarSql.includes(targetIntFlexAntigo)) {
  throw new Error('Trecho de intervalo flexivel nao encontrado em fn_confirmar_presenca')
}
fnConfirmarSql = fnConfirmarSql.replace(targetIntFlexAntigo, targetIntFlexNovo)

// Ajustar a resposta quando v_matched_action IS NULL
const targetFallbackAntigo = `        IF v_matched_action IS NULL THEN
            PERFORM public.fn_log_tentativa_negada(
                v_servidor_id, 
                p_matricula, 
                p_coordenador_id, 
                'Fora da janela de presença permitida.', 
                v_closest_inicio_formatted, v_closest_fim_formatted, NULL, NULL, NULL, NULL, NULL
            );
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de presença permitida.');
        END IF;`

const targetFallbackNovo = `        IF v_matched_action IS NULL THEN
            -- Se a entrada do primeiro bloco foi confirmada a menos de 60 minutos, responde amigavelmente
            -- que a presenca ja foi registrada, sem queimar intervalos nem gerar recusa indevida.
            IF v_b1_entradas[1] IS NOT NULL AND extract(epoch from (v_now - v_b1_entradas[1])) < 3600 THEN
                RETURN jsonb_build_object('success', true, 'message',
                    'Entrada já confirmada às ' || to_char(v_b1_entradas[1] AT TIME ZONE v_timezone, 'HH24:MI') || '. Bom trabalho!');
            END IF;

            PERFORM public.fn_log_tentativa_negada(
                v_servidor_id, 
                p_matricula, 
                p_coordenador_id, 
                'Fora da janela de presença permitida.', 
                v_closest_inicio_formatted, v_closest_fim_formatted, NULL, NULL, NULL, NULL, NULL
            );
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de presença permitida.');
        END IF;`

if (!fnConfirmarSql.includes(targetFallbackAntigo)) {
  throw new Error('Trecho de fallback nao encontrado em fn_confirmar_presenca')
}
fnConfirmarSql = fnConfirmarSql.replace(targetFallbackAntigo, targetFallbackNovo)

// Montar o arquivo final da migration
const migrationHeader = `-- ============================================================================
-- Migration: Guarda de Intervalo Mínimo e Proteção contra Batidas Repetidas na Entrada
-- Data: 2026-09-01
--
-- PROBLEMA
--   Quando o servidor chega pela manhã e bate o ponto 2x ou 3x em sequência rápida:
--   1. No terminal web (fn_confirmar_presenca), o modo de intervalo flexível aceitava
--      v_momento_atual_minutos > v_b_inicio, registrando as batidas seguintes como
--      saída para almoço e retorno de almoço logo nos primeiros minutos da manhã.
--   2. Na reconciliação automática (fn_alocar_marcacoes_dia), o piso do slot de intervalo
--      era 00:00 do dia, permitindo que marcações matinais fossem alocadas para o intervalo.
--
-- SOLUÇÃO
--   1. Em fn_alocar_marcacoes_dia: o piso dos slots de intervalo (intervalo_saida e retorno)
--      passa a exigir r.inicio_previsto + interval '60 minutes', impedindo matematicamente
--      que batidas da manhã casem com o intervalo.
--   2. Em fn_confirmar_presenca: o intervalo flexível passa a exigir no mínimo 60 minutos
--      decorridos desde a entrada. Se o servidor bater novamente nos primeiros 60 minutos,
--      o sistema responde amigavelmente "Entrada já confirmada às HH:MM" sem consumir passos.
--   3. As batidas de transição entre turnos (fronteira das 13h/15h) permanecem 100% intactas.
-- ============================================================================

`

const finalMigration = migrationHeader + fnAlocarSql + '\n\n' + fnConfirmarSql + '\n'

fs.writeFileSync(OUT_FILE, finalMigration, 'utf8')
console.log(`Migration gerada com sucesso: ${OUT_FILE} (${finalMigration.split('\n').length} linhas)`)
