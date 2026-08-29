-- ============================================================================
-- IP LOCAL DA MAQUINA QUE RODA O COLETOR
-- ============================================================================
-- 29/08/2026
--
-- POR QUE
--   A tela de Marcacoes ja mostra o hostname da maquina do coletor ("maquina: HMM-CCE-NI"), e
--   quem precisa acessar aquele computador (o "comunicador") nao tem como chegar nele so' com o
--   nome: nao ha WINS/DNS interno cobrindo as 23 unidades. O que existe hoje em
--   dispositivos_rep e' `endereco_ip` (o do RELOGIO) e `ultimo_ip_origem`, que e' o IP PUBLICO
--   da unidade - medido em 29/08/2026, os 23 dispositivos tem 45.173.x/177.55.x ali, e cinco
--   maquinas diferentes do HMI aparecem com o mesmo 45.173.175.9. Nenhum dos dois serve para
--   abrir uma sessao remota na maquina certa.
--
--   `coletor_ip` guarda o IP da maquina NA REDE DA UNIDADE (10.110.x, 192.168.x) - o mesmo
--   endereco pelo qual ela fala com o relogio.
--
-- QUEM PREENCHE
--   O proprio coletor, no heartbeat (v0.13.0), junto de coletor_versao/coletor_host. Coletor
--   anterior nao manda o campo e a coluna fica NULL - a tela simplesmente nao mostra, nunca um
--   valor inventado. Nada depende deste campo: e' informacao de suporte.
--
-- IDEMPOTENTE
--   ADD COLUMN IF NOT EXISTS.
-- ============================================================================

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS coletor_ip text;

COMMENT ON COLUMN public.dispositivos_rep.coletor_ip IS
    'IP da maquina que roda o coletor, na rede interna da unidade (reportado no heartbeat). '
    'Nao confundir com endereco_ip (o relogio) nem com ultimo_ip_origem (IP publico da unidade).';


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) A coluna existe:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'dispositivos_rep' AND column_name = 'coletor_ip';
--
--   2) Depois de o coletor v0.13.0 chegar as unidades, o IP local aparece ao lado do publico -
--      e os dois tem que ser DIFERENTES (se forem iguais, o coletor esta mandando o IP errado):
--
--   SELECT nome, endereco_ip AS relogio, coletor_host, coletor_ip, ultimo_ip_origem
--     FROM public.dispositivos_rep
--    WHERE ativo ORDER BY nome;
