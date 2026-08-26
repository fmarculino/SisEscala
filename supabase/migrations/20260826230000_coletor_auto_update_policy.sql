-- Migration: Politica de auto-atualizacao do coletor-rep-tray
--
-- POR QUE ISTO EXISTE
--   Ate a v0.11.2 o app de bandeja so AVISAVA que havia versao nova e esperava alguem clicar no
--   menu. Isso foi decisao explicita quando o parque tinha 1 ou 2 relogios e havia alguem por
--   perto. Medido em 26/08/2026, com 15 relogios: 11 estavam desatualizados (9 em v0.8.0, 1 em
--   v0.7.0, 1 em v0.10.0) e TODOS com contato recente com o SisEscala (0,1h a 7,1h). O gargalo
--   nunca foi rede nem maquina desligada - era o clique que ninguem dava.
--
--   Agrava: v0.9.0 foi quem trocou a fila offline plana pela fila por dispositivo. Em v0.8.0,
--   duas instancias na mesma maquina dividem %PROGRAMDATA%\SisEscala\fila e o lote de um relogio
--   pode ser reenviado com o TOKEN DO OUTRO - AFD atribuido ao equipamento errado, sem erro em
--   lugar nenhum. Ficar para tras nessas versoes nao e defasagem cosmetica.
--
-- POR QUE O INTERRUPTOR FICA NO SERVIDOR, E NAO NO CLIENTE
--   Trocar "espera clique" por "aplica sempre" trocaria um problema por um pior: um release ruim
--   alcancaria o parque inteiro em ate 24h, nas maquinas que sao justamente as que nao se
--   alcanca fisicamente. Defasagem e chato; parque inteiro derrubado e uma viagem a cada unidade.
--   Com a politica aqui, parar a propagacao e trocar uma linha - sem deploy e sem tocar em
--   nenhuma maquina. A rota GET /api/coletor-rep/tray-version le estas chaves e as devolve ao
--   coletor junto da versao.
--
--   Chave ausente = LIGADO (padrao do produto). Falha ao LER = desligado, decidido na rota: sem
--   conseguir ler a politica, o certo e nao mandar o parque trocar de binario.
--
-- AS OUTRAS DUAS DEFESAS VIVEM NO COLETOR (v0.12.0), NAO AQUI
--   - atraso aleatorio ate coletor_auto_update_atraso_max_minutos antes de aplicar, para o parque
--     nao trocar de binario todo no mesmo minuto;
--   - rollback: se o processo novo nao assumir o mutex de instancia unica em 3s (sintoma tipico
--     de Smart App Control/Defender bloqueando .exe recem-escrito, ja documentado neste projeto),
--     o executavel anterior e RESTAURADO, para o autostart do proximo boot nao lancar um binario
--     bloqueado e derrubar a unidade em silencio.
--
-- IDEMPOTENTE: INSERT ... WHERE NOT EXISTS, mesmo padrao de 20260808050000.

INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'coletor_auto_update', to_jsonb('true'::text)
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'coletor_auto_update');

INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'coletor_auto_update_atraso_max_minutos', to_jsonb('240'::text)
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'coletor_auto_update_atraso_max_minutos');


-- ============================================================================
-- COMO PARAR UMA VERSAO RUIM (runbook)
-- ============================================================================
--   UPDATE public.configuracoes_globais
--      SET valor = to_jsonb('false'::text)
--    WHERE chave = 'coletor_auto_update';
--
-- Efeito: no proximo ciclo de cada maquina (5 min) o coletor volta a so avisar. As que ja
-- atualizaram continuam na versao nova - reverter ESSAS exige publicar um dist/ anterior com
-- VERSION maior, porque compararVersoes so aceita subir. Por isso o atraso aleatorio importa:
-- ele e o que garante que nem todas terao atualizado quando o problema aparecer.
--
-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   SELECT chave, valor FROM public.configuracoes_globais
--    WHERE chave LIKE 'coletor_auto_update%';           -- esperado: 2 linhas
--
--   E a rota tem que devolver os campos novos:
--   curl -s https://sisescala.maraba.pa.gov.br/api/coletor-rep/tray-version
--   -> {"versao":"0.12.0","sha256":"...","auto_update":true,"atraso_max_minutos":240}
