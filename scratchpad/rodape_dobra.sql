-- ============================================================================
-- 4. fn_salvar_saida_bloco - copia de 20260706115000 + 2 insercoes
-- ============================================================================
-- E ela quem grava a saida do bloco. Com UM turno no bloco, so escreve a batida real. Com
-- varios, fabrica os horarios de transicao entre eles - e para isso precisa da MESMA cadeia
-- de horario que fn_confirmar_presenca usou para montar o bloco. Faltavam os niveis 1 e 2.

%%SALVAR_SAIDA_BLOCO%%


-- ============================================================================
-- 5. Permissoes
-- ============================================================================
-- CREATE OR REPLACE preserva os grants; repetir e barato e evita que a funcao fique
-- inacessivel se alguem trocar o REPLACE por DROP no futuro.

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;
