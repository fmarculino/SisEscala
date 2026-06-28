# Estudo e Plano de Concessão de Diárias e Pernoites

Este documento apresenta a especificação técnica e de negócios para a criação do módulo de **Diárias e Pernoites** integrado ao **SisEscala**. A finalidade deste módulo é automatizar o controle de viagens, cálculo de valores devidos aos servidores em deslocamento (motoristas, técnicos de informática, enfermeiros, etc.) e auditoria de prestação de contas, alinhado às boas práticas da administração pública brasileira.

---

## Estudo de Caso & Boas Práticas (RH & Gestão Pública)

Com base em nossa pesquisa sobre decretos municipais de diárias e o funcionamento do SCDP (Sistema de Concessão de Diárias e Passagens):
1. **Natureza Indenizatória:** Diárias cobrem despesas de alimentação, hospedagem e locomoção urbana. Não incorporam ao salário.
2. **Critério Temporal e Espacial:**
   - **Diária Integral (com pernoite):** Concedida quando o afastamento exige que o servidor durma fora de sua sede de trabalho.
   - **Meia-Diária (sem pernoite / alimentação):** Concedida quando o deslocamento ocorre sem pernoite, mas o afastamento ultrapassa uma quantidade mínima de horas (normalmente de 4 a 6 horas) ou distância mínima (ex: > 50km da sede).
3. **Diferenciação por Cargo e Destino:** Os valores são tabelados por decreto municipal cruzando a categoria do cargo (ex: Prefeito/Secretário vs. Técnico/Motorista) e o destino (Capital, Interior, Zona Rural/Vila/Assentamento, Interestadual).
4. **Fluxo de Rigor Fiscal (Prestação de Contas):** Toda viagem exige autorização prévia da chefia (Ordem de Serviço/Viagem) e posterior prestação de contas com comprovantes (relatórios assinados, certificados de presença, recibos de hospedagem/pedágio, etc.) sob pena de devolução dos valores e sanções administrativas.

---

## Estrutura do Banco de Dados Proposta (Supabase / Postgres)

### Tabelas de Cadastro e Movimentação

```sql
-- 1. Tabela de parametrização de valores de diárias por categoria e destino
CREATE TABLE IF NOT EXISTS public.diarias_tabelas_valores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_cargo TEXT NOT NULL, -- Ex: 'Grupo I: Secretários/Diretores', 'Grupo III: Efetivos/Motoristas/Técnicos'
    tipo_destino TEXT NOT NULL, -- Ex: 'Capital', 'Interior (Sede)', 'Zona Rural/Vila/Assentamento', 'Interestadual'
    valor_diaria NUMERIC(10,2) NOT NULL DEFAULT 0.00, -- Valor para diária cheia (com pernoite)
    valor_meia_diaria NUMERIC(10,2) NOT NULL DEFAULT 0.00, -- Valor para meia-diária (sem pernoite)
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_cargo_destino UNIQUE (grupo_cargo, tipo_destino)
);

-- 2. Tabela de solicitações de viagem/diárias
CREATE TABLE IF NOT EXISTS public.viagens_solicitacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id UUID NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    unidade_origem_id UUID NOT NULL REFERENCES public.unidades(id) ON DELETE RESTRICT,
    motivo TEXT NOT NULL, -- Justificativa do interesse público
    destino_tipo TEXT NOT NULL, -- Corresponde a tipo_destino da tabela de valores
    destino_detalhe TEXT NOT NULL, -- Ex: "Vila de Novo Paraíso - Posto de Saúde"
    data_partida TIMESTAMP WITH TIME ZONE NOT NULL,
    data_retorno TIMESTAMP WITH TIME ZONE NOT NULL,
    has_pernoite BOOLEAN NOT NULL DEFAULT false,
    
    -- Cálculos e valores aplicados (congelados no momento da aprovação)
    quantidade_diarias NUMERIC(4,1) NOT NULL DEFAULT 0.0, -- Ex: 1.5 diárias, 2.0 diárias
    quantidade_pernoites INTEGER NOT NULL DEFAULT 0,
    valor_diaria_aplicado NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    valor_meia_diaria_aplicado NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    valor_total_estimado NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    
    status TEXT NOT NULL DEFAULT 'rascunho' 
        CONSTRAINT chk_status_viagem CHECK (status IN (
            'rascunho', 'aguardando_aprovacao', 'aprovada', 'rejeitada', 
            'prestacao_contas_pendente', 'em_analise_prestacao', 'concluida', 'cancelada'
        )),
    
    criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    aprovado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    data_aprovacao TIMESTAMP WITH TIME ZONE,
    motivo_rejeicao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_datas_viagem CHECK (data_retorno > data_partida)
);

-- 3. Tabela de prestação de contas de viagens
CREATE TABLE IF NOT EXISTS public.viagens_prestacao_contas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    viagem_id UUID NOT NULL REFERENCES public.viagens_solicitacoes(id) ON DELETE CASCADE UNIQUE,
    relatorio_atividades TEXT NOT NULL, -- Descrição detalhada do que foi realizado
    documentos_urls JSONB NOT NULL DEFAULT '[]'::jsonb, -- Lista de comprovantes anexados (Supabase Storage)
    data_envio TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    status TEXT NOT NULL DEFAULT 'em_analise'
        CONSTRAINT chk_status_prestacao CHECK (status IN ('em_analise', 'aprovada', 'necessita_ajustes')),
    observacoes_analise TEXT,
    analisado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    data_analise TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

### Integração Automática com a Grade de Escalas

Para bloquear escalas e turnos comuns do servidor em período de viagem (evitando duplicidade na folha de ponto):

```sql
CREATE OR REPLACE FUNCTION public.fn_sincronizar_viagem_escala()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tipo_evento_id UUID;
BEGIN
  -- 1. Obter ou criar o tipo de evento 'Viagem a Serviço'
  SELECT id INTO v_tipo_evento_id FROM public.tipos_eventos WHERE nome = 'Viagem a Serviço' LIMIT 1;
  IF v_tipo_evento_id IS NULL THEN
     INSERT INTO public.tipos_eventos (nome, cor, descricao) 
     VALUES ('Viagem a Serviço', '#3B82F6', 'Servidor deslocado para atividades externas com diárias.')
     RETURNING id INTO v_tipo_evento_id;
  END IF;

  -- 2. Se a viagem foi aprovada, cria o evento de bloqueio na escala
  IF NEW.status = 'aprovada' AND OLD.status != 'aprovada' THEN
     INSERT INTO public.servidores_eventos (servidor_id, tipo_evento_id, data_inicio, data_fim, observacao, criado_por)
     VALUES (
        NEW.servidor_id, 
        v_tipo_evento_id, 
        NEW.data_partida::date, 
        NEW.data_retorno::date, 
        'Viagem para ' || NEW.destino_detalhe || ' (Solicitação #' || NEW.id || ')',
        NEW.criado_por
     );
  -- 3. Se a viagem for cancelada, remove o bloqueio na escala
  ELSIF NEW.status = 'cancelada' AND OLD.status = 'aprovada' THEN
     DELETE FROM public.servidores_eventos 
     WHERE servidor_id = NEW.servidor_id 
       AND tipo_evento_id = v_tipo_evento_id
       AND data_inicio = NEW.data_partida::date
       AND data_fim = NEW.data_retorno::date;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_sincronizar_viagem_escala
AFTER UPDATE ON public.viagens_solicitacoes
FOR EACH ROW
EXECUTE FUNCTION public.fn_sincronizar_viagem_escala();
```

---

## Fluxo de Telas Proposto (UI/UX)

1. **Dashboard & Solicitação (`/diarias`):**
   - Servidores e motoristas criam solicitações contendo destino, datas, justificativa e toggle de pernoite.
   - O sistema calcula e exibe dinamicamente o valor estimado baseando-se na tabela de valores ativos.
2. **Aprovação de Viagem:**
   - Coordenadores e Admins contam com uma aba central de pendências de viagem para aprovar ou rejeitar.
3. **Prestação de Contas (`/diarias/[id]`):**
   - Após o retorno, o servidor faz upload dos anexos comprobatórios (relatório de atividades, notas fiscais, fotos dos comprovantes) no aplicativo e envia para homologação.
4. **Parâmetros Tarifários (`/configuracoes/diarias`):**
   - Super Admins cadastram e reajustam valores de diárias cheias e meias-diárias por cargo e destino.
