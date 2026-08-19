-- Versao do coletor-rep ativo em cada dispositivo, para a tela /marcacoes mostrar no card quem
-- esta desatualizado sem precisar abrir a maquina da unidade.
--
-- Ate aqui a versao so existia em rep_sincronizacoes.coletor_versao (uma linha por lote), o que
-- e' historico de coleta, nao estado do dispositivo: com o sync incremental (v0.5.0) um relogio
-- sem batida nova nao gera lote nenhum, e a ultima linha pode ser de dias atras. Guardar no
-- proprio dispositivo separa "qual versao esta instalada la" de "quando ela falou pela ultima
-- vez" (coletor_versao_em), que sao as duas perguntas da tela.
--
-- Quem escreve: POST /api/rep/v1/heartbeat (todo ciclo de ~5 min, coletor >= 0.8.0) e
-- POST /api/rep/v1/marcacoes (todo lote de AFD, qualquer versao que ja mandava coletor_versao).
-- O segundo e' o que faz coletor antigo aparecer com a versao real em vez de "desconhecida".

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS coletor_versao    text,
    ADD COLUMN IF NOT EXISTS coletor_host      text,
    ADD COLUMN IF NOT EXISTS coletor_versao_em timestamptz;

COMMENT ON COLUMN public.dispositivos_rep.coletor_versao    IS 'Versao do coletor-rep que reportou por ultimo neste dispositivo (ciclo.Versao).';
COMMENT ON COLUMN public.dispositivos_rep.coletor_host      IS 'Hostname da maquina onde esse coletor roda.';
COMMENT ON COLUMN public.dispositivos_rep.coletor_versao_em IS 'Quando essa versao foi reportada - envelhece sozinha se o coletor parar de falar.';

-- Backfill a partir da ultima sincronizacao que trouxe versao. Nao inventa nada: dispositivo que
-- nunca sincronizou por coletor (so pendrive, ou recem-cadastrado) continua NULL, e a tela mostra
-- "versao desconhecida" em vez de um numero errado.
UPDATE public.dispositivos_rep d
   SET coletor_versao    = s.coletor_versao,
       coletor_host      = s.coletor_hostname,
       coletor_versao_em = s.iniciada_em
  FROM (
        SELECT DISTINCT ON (dispositivo_id)
               dispositivo_id, coletor_versao, coletor_hostname, iniciada_em
          FROM public.rep_sincronizacoes
         WHERE coletor_versao IS NOT NULL
         ORDER BY dispositivo_id, iniciada_em DESC
       ) s
 WHERE s.dispositivo_id = d.id
   AND d.coletor_versao IS NULL;

-- Conferencia: quem esta em qual versao agora.
-- SELECT nome, coletor_versao, coletor_host, coletor_versao_em
--   FROM public.dispositivos_rep ORDER BY coletor_versao NULLS FIRST;
