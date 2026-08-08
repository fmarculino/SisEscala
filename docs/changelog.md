# Changelog do Sistema SisEscala

Todas as alterações notáveis deste projeto são registradas neste arquivo.

## [Não versionado] - Integração com relógio de ponto (em andamento)

Implementação faseada do plano `docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md`.
**A versão só será fechada quando a implementação terminar.** Detalhamento técnico em
`docs/evolucao/2026-08-08-integracao-relogio-de-ponto-fases-0-a-4.md`.

### 🛠️ Correções de Erros (Fixes)
- **Folha de ponto reportava validação manual como batida real**:
  - A detecção de origem lia `logs_sobreaviso.motivo_acionamento` por comparação de string, mecanismo que parou de funcionar para Regular/Plantão/Extra em `20260807020000`. Além disso `'saida'` sem acento nunca casava com `'Saída'`, e os passos de intervalo não tinham detecção alguma.
  - **461 marcações de 08/2026** apareciam como batida real de terminal tendo sido validação manual do coordenador — 68% das saídas de intervalo e 63% dos retornos.
  - Corrigido com o helper único `src/utils/folha/origemMarcacao.ts`, que lê as flags `presenca_*_manual` da própria linha, aplicado nas quatro cópias da geração de folha.
- **Inserção arbitrária em `logs_tentativas_presenca`**:
  - A política RLS permitia a qualquer usuário autenticado inserir linhas forjadas, e essa tabela vira horário de folha de ponto através de `fn_batidas_reais_recusadas`. Escrita restrita à função oficial (`20260807130000`).
- **Presença em competência encerrada**:
  - O encerramento de competência protegia apenas `folha_ponto`. Agora um guard em `escala_diaria` impede alteração de presença em mês fechado (`20260808020000`).

### 🚀 Funcionalidades Adicionadas
- **Dados fiscais da unidade**: CNPJ, razão social, responsável legal (nome, CPF e cargo), gravados apenas com dígitos e com validação de formato. Necessários para o registro do Empregador no REP e para a futura emissão de AFD/AEJ.
- **Modelo de marcações de ponto** (`marcacoes_ponto`, `marcacoes_tratamentos`, `rep_afd_registros`, `rep_sincronizacoes`, `dispositivos_rep`, `rep_vinculos_servidor`):
  - Marcação **imutável por construção** — `UPDATE` e `DELETE` bloqueados por trigger, escrita revogada de todos os roles de aplicação, e cadeia de hash encadeada nos registros de AFD.
  - Coordenador nunca edita uma marcação: registra um **tratamento** sobre ela, e a original permanece para auditoria.
  - Origem rastreável (relógio / terminal / ajuste do coordenador / ajuste do servidor) com ordem de precedência aplicada em um único ponto.
  - Backfill de **7.142 marcações** a partir de todo o histórico de `escala_diaria`.
- **Ingestão de AFD**: parse do layout da Portaria 671, idempotente por lote e por NSR, com resolução do servidor pelo vínculo vigente na data da batida. Batida órfã nunca é descartada.
- **Sincronização automática**: toda escrita de presença em `escala_diaria` passa a espelhar em `marcacoes_ponto`, inclusive reversões.

### 🔍 Observações
- Nada disso altera o que o usuário vê. Terminal, grade e folha continuam no caminho atual — a virada de chave acontece por unidade, em fase posterior.
- Validado com hardware real: duas batidas biométricas no REP iDClass atravessaram o caminho completo até o banco, com cadeia de hash íntegra e zero órfãs.

---

## [1.19.1] - 2026-08-04

### 🛠️ Correções de Erros (Fixes)
- **Turno `T` em Jornadas 12h-18h**:
  - Ajuste nas funções `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` para herdar a hora inicial **12:00** da jornada regular quando a célula contiver o turno `T`.
- **Suporte a Escopos na RPC `fn_confirmar_presenca_manual`**:
  - Adicionado suporte completo aos valores `'completo'`, `'periodo_1'` e `'periodo_2'`, solucionando a falha *"Tipo de presença inválido."*.
- **Permissão de Leitura em `logs_tentativas_presenca` (RLS)**:
  - Política de segurança RLS liberada para Coordenadores e Administradores consultarem tentativas recusadas no modal de validação manual.

### 🎨 Alterações na Interface
- **Rótulos Dinâmicos nos Botões de Validação (`ScaleGrid.tsx`)**:
  - Rótulos ajustados para refletir dinamicamente a jornada agendada no dia (`Manhã`, `Entrada Tarde`, `Entrada Noturna`, etc.) sem descrições estáticas confusas.

---

## [1.19.0] - 2026-08-04

### 🚀 Funcionalidades Adicionadas
- **Validação em Massa de Presença em Multi-Níveis**:
  - **Nível 1 (Célula / Meio Período)**: Opções rápidas no modal para validar dia completo, 1º período (Manhã), 2º período (Tarde) ou batidas individuais.
  - **Nível 2 (Por Servidor)**: Ícone `<CheckSquare />` na grade ao lado do nome do servidor para validação de períodos configuráveis.
  - **Nível 3 (Global por Unidade)**: Botão `⚡ Validar em Massa` no topo da grade com modal interativo para validação em lote de múltiplos servidores.
- **Justificativa Obrigatória para Validações**:
  - Qualquer validação manual requer do gestor a inclusão de justificativa registrada em banco de dados.
- **Validação Manual de Sobreaviso Descumprido/Falhado**:
  - Modal de histórico permite validar manualmente chamados de sobreaviso pendentes ou que falharam, exigindo justificativa e reestabelecendo as horas na carga do servidor.
- **Visualização de Tentativas de Presença Negadas**:
  - Exibição de ícone ⚠️ com tooltip detalhando horários e motivos de recusa em tentativas registradas no terminal físico.

### 🎨 Alterações na Interface
- **Nomenclatura "PREVISÃO" e "PREV"**:
  - Alteração global dos termos `PLANEJADO` / `PLAN` para `PREVISÃO` / `PREV` na grade de escalas (`ScaleGrid.tsx`), relatórios consolidados e central de ajuda.

### 🛠️ Correções de Erros (Fixes)
- **Preservação de Registros Reais de Presença**:
  - Atualização da função SQL `fn_confirmar_presenca_manual` com `COALESCE` para garantir que batidas reais efetuadas pelo servidor via terminal físico não sejam sobrescritas pela validação em massa, preenchendo apenas os horários faltantes.
- **Contagem do Rodapé de Sobreaviso ("Servidores por Turno")**:
  - Ajuste na função `shiftTotals` em `ScaleGrid.tsx` para contabilizar servidores de sobreaviso escalados mesmo em caso de falha pontual em acionamentos anteriores.

---

## [1.18.0] - 2026-08-04
- **Refinamento dos Indicadores de Presença por Categoria e Despoluição Visual**

## [1.17.0] - 2026-08-04
- **Suporte Parametrizado à Marcação de Intervalo (Pausas) por Unidade**
