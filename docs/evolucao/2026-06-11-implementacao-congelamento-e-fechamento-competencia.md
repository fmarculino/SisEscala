# Evolução do Sistema: Implementação de Congelamento, Auto-Fechamento e Turnos Multi-Tipo (v1.4.0)

Este documento registra o relatório de execução e o histórico das alterações implementadas no **SisEscala** em 11/06/2026.

---

## 1. Escopo das Alterações Concluídas

### 1.1 Fechamento Automático de Períodos
- **Implementação:** Desenvolvido o arquivo [autoClose.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/autoClose.ts) contendo a rotina `autoCloseExpiredScalesAndTimesheets()`.
- **Funcionamento:** Compara a competência (mês/ano) com a data corrente mais a tolerância definida na chave `dias_inativacao_automatica` (configurada via página de governança).
- **Tolerância de Admin:** A comparação avalia se a data de última edição (`updated_at`/`ultima_edicao_em`) é posterior ao limite da expiração. Se positivo, indica que o administrador explicitamente reabriu ou editou a escala/folha de ponto, impedindo que o motor a re-feche automaticamente.
- **Integração:** Adicionados gatilhos automáticos nas páginas de visualização de escalas do coordenador, folhas de ponto e no login/consulta de escalas do Portal do Servidor.

### 1.2 Encerramento de Competência (Congelamento de Histórico)
- **Implementação:** Implementada a Server Action `toggleCompetencyClosure(mes, ano, lock)` e a função `isCompetencyClosed(mes, ano)` em [autoClose.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/autoClose.ts).
- **Gerenciamento:** Seção criada na aba de Configurações ([page.tsx (configurações)](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/configuracoes/page.tsx)), liberada para controle exclusivo de usuários com role `'super_admin'`. Usuários `'admin'` possuem visualização somente leitura.
- **Restrição Visual:**
  - Grade de Escalas ([ScaleGrid.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx)) bloqueia qualquer alteração nas células, remoção de servidores, registros manuais de sobreaviso e oculta o botão "Reabrir Escala" caso a competência esteja locked.
  - Editor de Folhas de Ponto ([FolhaPontoEditor.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx)) bloqueia edições de horários, justificativas e desabilita todas as ações administrativas (Salvar, Regenerar, Sincronizar, Finalizar, Revisar) e de reabertura, exibindo um banner vermelho de aviso.
- **Restrição de Banco:** Inserida verificação ativa `isCompetencyClosed` em todas as ações de gravação administrativas de folha de ponto.

### 1.3 Suporte a Turnos Multi-Tipo
- **Banco de Dados (Migração SQL):**
  - Implementada a migração [20260611010000_alter_dicionario_turnos_tipo_to_text.sql](file:///c:/Users/Cliente/Projetos/SisEscala/supabase/migrations/20260611010000_alter_dicionario_turnos_tipo_to_text.sql) que converte o campo `dicionario_turnos.tipo` para `text`, liberando o salvamento de múltiplos tipos combinados separados por vírgula.
- **Formulário de Turno:**
  - Telas de criação ([novo/page.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/turnos/novo/page.tsx)) e edição ([[id]/page.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/turnos/[id]/page.tsx)) ajustadas para utilizar checkboxes para os tipos de turnos (**Normal**, **Plantão**, **Sobreaviso**, **Extra**).
  - Listagem de turnos ([page.tsx (turnos)](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/turnos/page.tsx)) atualizada para filtrar registros combinados e renderizar badges individuais lado-a-lado.
- **Filtros no Grid de Escalas:**
  - O dropdown (datalist) de seleção de turnos em [ScaleGrid.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx) filtra dinamicamente os turnos de acordo com a categoria da linha (linhas normais listam apenas Normal, linhas de plantão apenas Plantão, extras apenas Extra, sobreaviso apenas Sobreaviso), previnindo a inserção de turnos de categorias incompatíveis.

### 1.4 Correção do Bloqueio da Folha de Ponto no Portal do Servidor
- **Problema:** Ao fechar e reabrir o período, o servidor não conseguia mais alterar dados no portal devido à trava `!isPortal` na variável `isEditable` de [FolhaPontoEditor.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx).
- **Correção:** Alterada a variável `isEditable` para ignorar a restrição de portal (permitindo que o funcionário edite se a folha não estiver trancada por revisão do coordenador ou trancamento de competência):
  ```typescript
  const isEditable = status !== 'Revisada' && !isCompetenciaEncerrada
  ```
- **Segurança:** Inclusão de checagens do `isCompetencyClosed` nas server actions de escrita utilizadas pelo portal no arquivo [actions.ts (portal)](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/consultar-escala/actions.ts).

---

## 2. Inventário de Arquivos Modificados/Criados

```
├── docs/
│   ├── planos/
│   │   └── 2026-06-11-congelamento-e-auto-fechamento.md [NEW]
│   └── evolucao/
│       └── 2026-06-11-implementacao-congelamento-e-fechamento-competencia.md [NEW]
├── src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── configuracoes/
│   │   │   │   └── page.tsx [MODIFY]
│   │   │   ├── escalas/
│   │   │   │   ├── unidade/[unidadeId]/
│   │   │   │   │   ├── ScaleGrid.tsx [MODIFY]
│   │   │   │   │   └── page.tsx [MODIFY]
│   │   │   │   └── page.tsx [MODIFY]
│   │   │   ├── folha-ponto/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── FolhaPontoEditor.tsx [MODIFY]
│   │   │   │   └── actions.ts [MODIFY]
│   │   │   └── turnos/
│   │   │       ├── [id]/
│   │   │       │   └── page.tsx [MODIFY]
│   │   │       ├── novo/
│   │   │       │   └── page.tsx [MODIFY]
│   │   │       ├── actions.ts [MODIFY]
│   │   │       └── page.tsx [MODIFY]
│   │   └── consultar-escala/
│   │       ├── ConsultarEscalaClient.tsx [MODIFY]
│   │       ├── actions.ts [MODIFY]
│   │       └── page.tsx [MODIFY]
│   └── utils/
│       └── autoClose.ts [NEW]
├── supabase/
│   └── migrations/
│       └── 20260611010000_alter_dicionario_turnos_tipo_to_text.sql [NEW]
└── CHANGELOG.md [MODIFY]
```

---

## 3. Validação Executada
- **Compilação TypeScript:** `npx tsc --noEmit` executado com êxito sem gerar erros.
- **Ambiente de Desenvolvimento:** Servidor de desenvolvimento dev ativo e monitorado durante os testes.
