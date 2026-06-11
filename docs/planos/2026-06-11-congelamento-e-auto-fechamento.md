# Plano de Implementação: Encerramento de Competência e Fechamento Automático (v1.4.0)

Este documento registra a especificação técnica, o estudo arquitetural e o plano de implementação para o **Encerramento de Competência (Congelamento de Histórico)** e o **Fechamento Automático de Períodos por Inatividade** no SisEscala.

---

## 1. Conceito e Arquitetura

Para manter a consistência jurídica e permitir auditorias futuras sem riscos de adulterações retroativas de escalas e frequências, o sistema necessita de duas regras de congelamento temporal:

1. **Fechamento Automático (Prazo Expirado)**: Escalas e folhas de ponto de meses anteriores devem se trancar de forma autônoma após $N$ dias do encerramento do mês (configurável pelo admin, padrão de 5 dias).
2. **Encerramento de Competência (Congelamento Definitivo)**: Prerrogativa do **Administrador Geral (super_admin)** para trancar em definitivo um mês/ano. Uma vez encerrado, edições tornam-se impossíveis por qualquer perfil de usuário (incluindo administradores). Apenas o Administrador Geral pode reabrir um período trancado.

---

## 2. Estrutura de Dados e Persistência

### 2.1 Armazenamento das Competências Encerradas
Para evitar alterações complexas de DDL e novos relacionamentos em um banco remoto de produção, utilizaremos o modelo chave-valor na tabela existente `configuracoes_globais`:

- **Chave**: `'competencias_encerradas'`
- **Valor (JSONB)**:
```json
[
  {
    "mes": 6,
    "ano": 2026,
    "encerrado_por": "3b29d4c1-4eb8-4226-9d32-d04b3cfc23cd",
    "encerrado_em": "2026-06-11T04:00:00Z"
  }
]
```

### 2.2 Controle de Prazo Expirado (Inativação Automática)
- **Chave**: `'dias_inativacao_automatica'` (representa o número de dias após o fim do mês em que escalas e folhas são trancadas).

---

## 3. Especificação Técnica e Fluxo das Ações

### 3.1 Função Utilitária e Server Actions (`autoClose.ts`)
As rotinas de checagem e atualização em lote serão encapsuladas em [autoClose.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/autoClose.ts) utilizando o `createAdminClient` para assegurar que as atualizações em lote contornem restrições comuns de RLS para coordenadores, mantendo a trilha de auditoria:

* **`autoCloseExpiredScalesAndTimesheets()`**:
  - Busca as escalas abertas (`status != 'Fechada'`) e as folhas não fechadas (`status != 'Revisada'`).
  - Calcula a data limite de fechamento.
  - **Exceção de Admin (Evitar Loop de Re-fechamento):** Se o registro foi reaberto manualmente pelo administrador (sua data `updated_at`/`ultima_edicao_em` é posterior à data limite calculada), o sistema ignora o registro e não o re-tranca de forma cíclica.
  - Atualiza o status das escalas expiradas para `'Fechada'` e das folhas de ponto para `'Revisada'`.
  - Registra a ação na tabela `logs_sistema`.

* **`toggleCompetencyClosure(mes, ano, lock)`**:
  - Valida se o usuário logado possui a role `'super_admin'`.
  - Atualiza o array da chave `'competencias_encerradas'` na tabela `configuracoes_globais`.

* **`isCompetencyClosed(mes, ano)`**:
  - Função auxiliar executada antes de qualquer ação de escrita nas tabelas `escala_diaria`, `escala_mensal` e `folha_ponto`.

---

## 4. Defesa de Relações e Validação no Frontend

### 4.1 Interface de Gerenciamento (`/configuracoes`)
- Painel para alternar o status de trancamento de competências.
- Exibição condicional:
  - `super_admin`: Controles ativos para trancar/destrancar.
  - `admin` comum: Lista de períodos trancados em estado desabilitado (Read-Only) com banner explicativo.

### 4.2 Grade de Escala (`ScaleGrid.tsx`)
- Desativação dos inputs das células se a competência estiver encerrada.
- Desativação do botão de remoção de servidores e do botão de salvar.
- Ocultação do botão **"Reabrir Escala"** se a competência estiver encerrada (evitando que coordenadores destranquem dados consolidados).

### 4.3 Editor de Folhas de Ponto (`FolhaPontoEditor.tsx`)
- Definição da flag de edição:
  ```typescript
  const isEditable = status !== 'Revisada' && !isCompetenciaEncerrada
  ```
- Desativação completa dos controles e inputs no corpo da folha.
- Banner em destaque em tom vermelho notificando o congelamento da competência para auditoria.
- Ocultação dos botões administrativos de trâmite de status para usuários do portal.

---

## 5. Plano de Testes e Homologação

### 5.1 Testes de Integração
- Rodar `npx tsc --noEmit` para verificar a consistência dos imports de `isCompetencyClosed` e tipos associados.

### 5.2 Teste de Segurança (Invasão de API)
- Autenticar com usuário sem privilégios (`servidor` ou `coordenador`) e tentar invocar `toggleCompetencyClosure` via console/action, verificando que o servidor recusa a operação com erro de permissão.
- Tentar alterar um registro de ponto em competência trancada usando script de teste ou modificação local de estado e validar a barreira na server action do banco de dados.
