# Plano de Implementação: Auditoria Vinculada de Sessões de Presença

Este documento descreve a estratégia para implementar o rastreamento de "Sessões de Presença" no SisEscala, permitindo vincular a ativação de um terminal por um coordenador a cada confirmação de presença individual feita pelos servidores.

## 1. Objetivo
Garantir rastreabilidade total no Terminal de Presença, permitindo identificar em qual "janela de tempo" e sob qual "supervisão" cada servidor registrou seu ponto.

## 2. Alterações no Banco de Dados (PostgreSQL/Supabase)

### 2.1 Nova Tabela: `presenca_sessoes`
Esta tabela armazenará os períodos em que um terminal esteve ativo.

```sql
CREATE TABLE public.presenca_sessoes (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    coordenador_id UUID REFERENCES public.profiles(id) NOT NULL,
    unidade_id UUID REFERENCES public.unidades(id),
    setor_id UUID REFERENCES public.setores(id),
    inicio_em TIMESTAMPTZ DEFAULT now() NOT NULL,
    fim_em TIMESTAMPTZ,
    status TEXT DEFAULT 'Ativa' CHECK (status IN ('Ativa', 'Encerrada')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.presenca_sessoes ENABLE ROW LEVEL SECURITY;
```

### 2.2 Funções de Banco de Dados (RPC)

#### Iniciar Sessão
```sql
CREATE OR REPLACE FUNCTION public.fn_iniciar_sessao_presenca(
    p_coordenador_id UUID,
    p_unidade_id UUID,
    p_setor_id UUID
) RETURNS UUID AS $$
DECLARE
    v_sessao_id UUID;
BEGIN
    INSERT INTO public.presenca_sessoes (coordenador_id, unidade_id, setor_id)
    VALUES (p_coordenador_id, p_unidade_id, p_setor_id)
    RETURNING id INTO v_sessao_id;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes, unidade_id, setor_id)
    VALUES (p_coordenador_id, 'ATIVACAO_TERMINAL', 
            jsonb_build_object('sessao_id', v_sessao_id, 'info', 'Terminal de presença ativado'),
            p_unidade_id, p_setor_id);
            
    RETURN v_sessao_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### Encerrar Sessão
```sql
CREATE OR REPLACE FUNCTION public.fn_encerrar_sessao_presenca(p_sessao_id UUID) 
RETURNS VOID AS $$
BEGIN
    UPDATE public.presenca_sessoes 
    SET status = 'Encerrada', fim_em = now() 
    WHERE id = p_sessao_id;

    -- Registrar log de encerramento
    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    SELECT coordenador_id, 'DESATIVACAO_TERMINAL', jsonb_build_object('sessao_id', id, 'info', 'Terminal de presença encerrado')
    FROM public.presenca_sessoes WHERE id = p_sessao_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 3. Integração com `fn_confirmar_presenca`

A função existente deve ser alterada para aceitar `p_sessao_id UUID`.

**Alteração nos Logs de Auditoria:**
Ao inserir o log de confirmação, incluir o vínculo:
```sql
INSERT INTO logs_sistema (user_id, acao, detalhes, unidade_id, setor_id)
VALUES (p_coordenador_id, 'PRESENCA_CONFIRMADA', 
        jsonb_build_object(
            'sessao_id', p_sessao_id, 
            'servidor_id', v_servidor_id,
            'info', 'Presença vinculada à sessão do coordenador'
        ),
        v_unidade_id, v_setor_id);
```

## 4. Lógica de Frontend (`src/app/presenca/page.tsx`)

1.  **Estado da Sessão**: Criar um state `sessaoId` e sincronizá-lo com `localStorage`.
2.  **Ativação**: No `handleSupervisorLogin`, após o sucesso, chamar `fn_iniciar_sessao_presenca` e salvar o ID retornado.
3.  **Confirmação**: No `handleConfirm`, passar o `sessaoId` como argumento para a RPC de confirmação.
4.  **Encerramento**: No `handleLogout`, chamar `fn_encerrar_sessao_presenca` antes de limpar os dados locais.

## 5. Exemplo de Consulta de Auditoria

Para listar todos os servidores que confirmaram presença em uma sessão específica de um coordenador:

```sql
SELECT 
    ls.created_at as momento,
    p.full_name as servidor,
    ls.detalhes->>'sessao_id' as sessao
FROM logs_sistema ls
JOIN profiles p ON (ls.detalhes->>'servidor_id')::uuid = p.id
WHERE ls.detalhes->>'sessao_id' = 'ID_DA_SESSAO_AQUI'
ORDER BY ls.created_at ASC;
```

---
**Documento gerado em:** 2026-05-11
**Status:** Planejado / Aguardando Implementação
