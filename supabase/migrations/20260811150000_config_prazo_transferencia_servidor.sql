-- Migration: Configuração de Prazo em Dias Úteis para Transferência de Servidor
-- Data: 2026-08-11
-- Descrição: Insere a chave dias_uteis_transferencia_servidor na tabela configuracoes_globais
--            para definir a antecedência mínima em dias úteis exigida para solicitação/efetivação
--            de transferências de lotação de servidores.

INSERT INTO public.configuracoes_globais (chave, valor, descricao, updated_at)
VALUES (
  'dias_uteis_transferencia_servidor', 
  '1', 
  'Quantidade de dias úteis exigidos de antecedência para solicitação ou efetivação da transferência de servidor. Impede pedidos retroativos ou na data vigente.', 
  NOW()
)
ON CONFLICT (chave) DO NOTHING;
