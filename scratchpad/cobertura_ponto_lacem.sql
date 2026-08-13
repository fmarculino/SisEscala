-- Cobertura de cadastro no relogio x escala (LACEM, agosto/2026)
--
-- Responde "todo servidor escalado consegue efetivamente bater ponto no rele?". Roda como
-- consulta de conferencia (SELECT puro, nao altera nada). Trocar :mes/:ano/o filtro do
-- dispositivo para reusar em outra unidade.
--
-- O que decide cada situacao, em ordem de gravidade:
--
--   SEM CPF NO SISESCALA  -> nao da nem para empurrar a identidade: fn_enfileirar_cadastros_rep
--                            pula quem nao tem CPF, e identificador_afd E' o CPF (armadilha 10).
--   FORA DO RELOGIO       -> nao aparece no ultimo snapshot de load_users.fcgi. Nao tem como bater.
--   SEM BIOMETRIA         -> cadastrado no rele, mas sem template. So' a identidade foi empurrada
--                            (Fase 7); alguem precisa ir ate o equipamento com a pessoa.
--   SEM VINCULO           -> tem cadastro e biometria, mas nao ha rep_vinculos_servidor vigente:
--                            a batida entra em rep_afd_registros e morre como ORFA, sem virar
--                            marcacao de ninguem. Foi exatamente o que o log da LACEM mostrou em
--                            12/08/2026 (marcacoes == orfas em todo lote).
--   OK                    -> cadastrado, com biometria e com vinculo vigente.
--
-- ATENCAO: rep_usuarios_dispositivo e' um SNAPSHOT — vale a data do ultimo `coletor-rep higiene`
-- (a coluna atualizado_em diz quando). Rode a higiene antes desta consulta se a resposta for
-- usada para decidir algo.

WITH disp AS (
    SELECT id, nome, unidade_id
      FROM public.dispositivos_rep
     WHERE nome ILIKE '%lacem%'          -- <<< confira: e' o nome que aparece na tela de Marcacoes
     LIMIT 1
),
escalados AS (
    -- Quem tem pelo menos um dia de escala que exige presenca no mes. Sobreaviso fora de
    -- proposito: nao marca ponto (CLAUDE.md armadilha 6).
    SELECT DISTINCT em.servidor_id
      FROM public.escala_mensal em
      JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
     WHERE em.mes = 8 AND em.ano = 2026
       AND em.unidade_id = (SELECT unidade_id FROM disp)
       AND ed.categoria::text <> 'Sobreaviso'
)
SELECT s.matricula,
       s.nome,
       s.status,
       u.identificador_afd                    AS identificador_no_relogio,
       u.nome_no_device,
       COALESCE(u.tem_biometria, false)       AS tem_biometria,
       (v.id IS NOT NULL)                     AS tem_vinculo_vigente,
       u.atualizado_em                        AS snapshot_de,
       CASE
           WHEN regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g') = '' THEN '1. SEM CPF NO SISESCALA'
           WHEN u.identificador_afd IS NULL                            THEN '2. FORA DO RELOGIO'
           WHEN NOT COALESCE(u.tem_biometria, false)                   THEN '3. SEM BIOMETRIA'
           WHEN v.id IS NULL                                           THEN '4. SEM VINCULO (batida vira orfa)'
           ELSE '5. OK'
       END AS situacao
  FROM escalados e
  JOIN public.servidores s ON s.id = e.servidor_id
  LEFT JOIN public.rep_usuarios_dispositivo u
         ON u.dispositivo_id = (SELECT id FROM disp)
        AND u.identificador_afd = lpad(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 12, '0')
  LEFT JOIN public.rep_vinculos_servidor v
         ON v.dispositivo_id = (SELECT id FROM disp)
        AND v.servidor_id = s.id
        AND v.vigente_ate IS NULL
 WHERE s.status = 'Ativo'
 ORDER BY situacao, s.nome;


-- Resumo em uma linha por situacao (rode separado se quiser so' a contagem):
--
--   WITH ... (mesmo WITH acima)
--   SELECT situacao, count(*) FROM (<a consulta acima>) t GROUP BY 1 ORDER BY 1;


-- A direcao inversa (quem esta no relogio e nao esta escalado no mes) ja tem tela: aba
-- "Higiene do Relogio" em /marcacoes. Esta consulta e' a que faltava — escala -> relogio.
