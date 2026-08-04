# Changelog do Sistema SisEscala

Todas as alterações notáveis deste projeto são registradas neste arquivo.

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
