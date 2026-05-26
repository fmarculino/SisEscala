# Plano de Implementação: Notificações Ativas e Cobertura (v0.7.0)

Este documento registra a especificação técnica e o planejamento para a implementação do **Sistema de Notificações Ativas** e do **Dashboard de Cobertura** no SisEscala.

---

## 1. Sistema de Notificações Ativas

### 1.1 Objetivo
Notificar automaticamente os servidores quando houver publicações ou alterações em suas escalas de serviço, além de alertar os coordenadores sobre eventuais subdimensionamentos.

### 1.2 Estrutura do Banco de Dados
Nova tabela para enfileiramento e log de envio de notificações:

```sql
CREATE TABLE public.fila_notificacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id UUID REFERENCES public.servidores(id) ON DELETE CASCADE,
    escala_mensal_id UUID REFERENCES public.escala_mensal(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('EscalaPublicada', 'EscalaAlterada', 'AlertaFuro')),
    canal TEXT NOT NULL CHECK (canal IN ('Email', 'WhatsApp')),
    destinatario TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    status TEXT DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Enviado', 'Falhou')),
    erro_mensagem TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    enviado_em TIMESTAMPTZ
);

-- Índices para otimização de busca na fila de envio
CREATE INDEX idx_fila_notificacoes_status ON public.fila_notificacoes(status);
```

### 1.3 Lógica de Negócio e Envio
* **E-mail (SMTP):** Configuração no servidor Next.js usando a biblioteca `nodemailer`. As credenciais de SMTP serão gerenciadas via variáveis de ambiente da VPS:
  * `SMTP_HOST`
  * `SMTP_PORT`
  * `SMTP_USER`
  * `SMTP_PASS`
* **WhatsApp:** Preparado para conexão via APIs de Gateway de terceiros (ex: Twilio, Evolution API ou Z-API).
* **Fluxo de Disparo:**
  1. Ao publicar a escala (alterar status da `escala_mensal` de `'Rascunho'` para `'Fechada'`), uma Server Action cria registros na `fila_notificacoes`.
  2. Em caso de edição posterior, apenas os servidores cujos turnos sofreram alteração serão notificados (`'EscalaAlterada'`).

---

## 2. Dashboard de Cobertura de Escalas

### 2.1 Objetivo
Permitir que coordenadores vejam se um determinado setor atingiu o número mínimo de profissionais necessários por turno a cada dia do mês.

### 2.2 Estrutura do Banco de Dados
Tabela para configurar a necessidade diária de pessoal por setor e turno:

```sql
CREATE TABLE public.cobertura_minima (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setor_id UUID REFERENCES public.setores(id) ON DELETE CASCADE NOT NULL,
    turno_id UUID REFERENCES public.dicionario_turnos(id) ON DELETE CASCADE NOT NULL,
    dia_semana INTEGER CHECK (dia_semana BETWEEN 0 AND 6), -- NULL indica que vale para qualquer dia
    quantidade_minima INTEGER DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT cobertura_minima_setor_turno_dia_key UNIQUE (setor_id, turno_id, dia_semana)
);
```

### 2.3 Função RPC de Análise de Furos (PostgreSQL)
Função para calcular o saldo de pessoal de forma consolidada no mês:

```sql
CREATE OR REPLACE FUNCTION public.fn_obter_cobertura_setor(
    p_unidade_id UUID,
    p_setor_id UUID,
    p_mes INTEGER,
    p_ano INTEGER
)
RETURNS TABLE (
    dia INTEGER,
    turno_codigo TEXT,
    quantidade_planejada INTEGER,
    quantidade_minima INTEGER,
    status_cobertura TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH planejados AS (
        SELECT ed.dia, dt.id AS turno_id, dt.codigo AS turno_codigo, COUNT(ed.id)::integer AS qtd
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        WHERE em.unidade_id = p_unidade_id
          AND em.setor_id = p_setor_id
          AND em.mes = p_mes
          AND em.ano = p_ano
        GROUP BY ed.dia, dt.id, dt.codigo
    )
    SELECT 
        p.dia,
        p.turno_codigo,
        p.qtd AS quantidade_planejada,
        COALESCE(c.quantidade_minima, 1) AS quantidade_minima,
        CASE 
            WHEN p.qtd >= COALESCE(c.quantidade_minima, 1) THEN 'OK'
            ELSE 'Subdimensionado'
        END AS status_cobertura
    FROM planejados p
    LEFT JOIN public.cobertura_minima c ON c.setor_id = p_setor_id AND c.turno_id = p.turno_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

### 2.4 Interface e Componentes Propostos
* **Componente de Configuração:** Modal para coordenadores definirem as metas na aba de configurações.
* **Componente Gráfico (`CoverageChart.tsx`):** Gráfico interativo exibindo a cobertura diária.
* **Sinalização Visual no Grid:** Ícone vermelho de aviso nos turnos subdimensionados na grade de escalas.

---
**Documento gerado em:** 2026-05-26  
**Status:** Planejado / Arquivado para Futura Implementação
