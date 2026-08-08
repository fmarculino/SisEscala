# Changelog do Sistema SisEscala

Todas as alterações notáveis deste projeto são registradas neste arquivo.

## [1.23.1] - 2026-08-08

### 🛠️ Correções de Erros (Fixes)
- **Solicitação de ajuste de ponto aceitava dia futuro**:
  - Defeito introduzido pela própria 1.23.0: o botão "informar horário" aparecia em toda célula vazia do mês, inclusive dias que ainda não tinham ocorrido. Não existe "esqueci de bater o ponto" de um dia futuro — a solicitação existe para justificar algo que já aconteceu fora do esperado, não para pré-registrar jornada.
  - Bloqueio em duas camadas: o botão só aparece para dias já ocorridos (`FolhaPontoEditor.tsx`), e `fn_solicitar_ajuste_ponto` recusa no banco qualquer dia com `data > CURRENT_DATE` — mesmo critério já usado em `fn_confirmar_presenca_manual`.
  - Turno noturno em andamento também é coberto: solicitar a saída antes de ela ter de fato ocorrido (ex.: entrada 22h, saída 6h do dia seguinte, solicitado às 23h do mesmo dia) é recusado mesmo com o dia da entrada já no passado.

---

## [1.23.0] - 2026-08-08

### 🚨 Alterações de Comportamento (Breaking)
- **O portal do servidor deixa de permitir edição direta da folha de ponto**:
  - A v1.22.0 removeu a geração automática de horário para entrada e saída, e a célula vazia resultante virou uma porta perigosa: o servidor editava qualquer campo não marcado como `real`, e a edição ia direto para `folha_ponto.registros` sem passar por revisão, sem criar marcação e sem deixar rastro de quem alterou o quê. Trocamos "ajustar um horário fictício limitado" por "declarar do zero na folha oficial, sem conferência".
  - Os quatro campos de horário e a observação da folha agora são **somente leitura** no portal, em todas as camadas: interface (`FolhaPontoEditor`) e servidor (`salvarFolhaPontoServidor` recusa qualquer alteração de horário, mesmo se chamada diretamente).

### 🚀 Funcionalidades Adicionadas
- **Solicitação de ajuste de ponto pelo servidor**:
  - Em dias de trabalho sem entrada ou saída registrada, aparece o botão **"informar horário"** na folha do portal. O servidor informa o horário que cumpriu e o motivo; isso vira uma marcação de origem `ajuste_servidor` — a mais baixa das quatro precedências (perde para relógio, terminal e ajuste do coordenador) — **pendente de revisão**, sem tocar a folha.
  - A fila de revisão do coordenador (`fn_marcacoes_pendentes_revisao`) passa a incluir essas solicitações lado a lado com as batidas fora da janela, distinguíveis pela origem.
  - O atestado de jornada em massa (`fn_atestar_jornada_bulk`) passa a pular também os dias com solicitação pendente do servidor, pela mesma razão que já pulava batidas do terminal: não atropelar informação real com horário contratual.
  - Passo que já tem horário registrado recusa a solicitação — contestar um registro existente não é autoatendimento, fica com o coordenador.

### 🔍 Observações
- O servidor mantém a voz (ele é quem sabe o horário real), o coordenador mantém a decisão, e tudo fica rastreado — a mesma lógica de precedência e revisão construída para o terminal nesta mesma data, agora estendida ao portal.
- `fn_confirmar_presenca_manual` e `fn_confirmar_presenca_manual_bulk` não foram alteradas.

---

## [1.22.1] - 2026-08-08

### 🛠️ Correções de Erros (Fixes)
- **Validação em massa atropelava batidas pendentes de revisão**:
  - Defeito introduzido pela própria 1.22.0: o terminal passou a registrar batidas fora da janela como pendentes, mas a validação em massa não sabia disso. Um servidor que batia às 07:40 e ficava pendente podia ter o dia atestado com o **horário contratual**, enquanto o horário verdadeiro estava disponível e ninguém olhava.
  - `fn_atestar_jornada_bulk` separa os dias com batida pendente, deixa-os de fora do atestado e **devolve a lista** para tratamento individual com o horário real.
  - A exclusão é por par **(escala, dia)**: uma pendência no dia 5 não impede atestar os dias 6 a 30 do mesmo servidor. Pendência já tratada deixa de bloquear.
  - A grade mostra o que ficou de fora — por dia e horário no modo por servidor, agrupado por pessoa no modo global.

### 🔍 Observações
- É a mesma regra de precedência de `fn_precedencia_origem` (relógio > terminal > ajuste), trazida para o fluxo do coordenador: **onde existe horário real disponível, ele ganha do declarado**.
- Atestar em massa continua existindo, e deve: quando ninguém bateu, alguém precisa declarar o que houve. Deixa apenas de atropelar o que foi batido.
- **Retificação da 1.22.0:** aquela versão registrou a validação em massa como "exposição residual à vedação 2". Conferido em produção depois das correções: ela já grava com origem `ajuste_coordenador` e `sintetica = true`, e a folha já a pinta como `manual` — o sistema não a apresenta como batida. Um coordenador declarando, com justificativa e rótulo próprio, é tratamento autorizado pelo Art. 82, parágrafo único. O problema real era o de precedência, corrigido aqui.
- `fn_confirmar_presenca_manual_bulk` não foi alterada.

---

## [1.22.0] - 2026-08-08

### ⚖️ Conformidade com a Portaria 671/2021

A Portaria 671/2021 veda, em qualquer registrador eletrônico de ponto — inclusive no REP-P, que é o registrador **via programa**, categoria em que o terminal do SisEscala se enquadra:

1. restrições de horário à marcação do ponto;
2. marcação automática usando horários predeterminados ou contratuais;
3. exigência de autorização prévia para marcar sobrejornada;
4. qualquer dispositivo que permita alterar o dado registrado pelo empregado.

O sistema incorria na 1 e na 2. Esta versão corrige ambas.

#### 🚨 Alterações de Comportamento (Breaking)
- **O terminal não recusa mais batida fora do horário previsto**:
  - Confirmada a identidade, a batida é **sempre** registrada. Antes, quem chegava atrasado, saía mais cedo ou fazia hora extra simplesmente não conseguia registrar, e o horário real se perdia.
  - Fora da janela, a marcação nasce **pendente de revisão** e o coordenador decide — em vez de virar presença aprovada automaticamente.
  - O feedback mudou de vermelho (recusa) para **âmbar (alerta)**: *"Ponto registrado às HH:MM. Fora do horário previsto — seu coordenador vai revisar."* Vermelho ficou reservado ao único caso que ainda é recusado: matrícula ou PIN inválidos, que é falta de identificação, não restrição de horário.
- **A folha não gera mais horário fictício para entrada e saída do turno**:
  - Em todas as unidades o servidor tem como registrar entrada e saída, então preencher ali era marcação automática por horário contratual. Dia sem batida agora fica **vazio** e vira tratamento do coordenador.
  - Medido em produção: afeta ~5–6% das células de entrada/saída nas competências fechadas.
- **O intervalo passa a ser pré-assinalado, não sorteado**:
  - Mantido apenas onde a unidade **não exige** marcação de intervalo — ali o servidor não tem como registrar o repouso, e a CLT Art. 74 §2º nomeia exatamente esse mecanismo: *"com a pré-assinalação do período de repouso"*.
  - O deslocamento aleatório de ±1 a 14 minutos foi removido: pré-assinalação pressupõe horário pré-anotado. A origem passou de `ficticio` para `pre_assinalado`.
- **A validação manual passa a exigir o horário informado pelo servidor**:
  - O coordenador digita o horário que o servidor declara ter cumprido, em vez de o sistema herdar o da jornada. Nas competências fechadas, a validação manual respondia por 24–29% das entradas e saídas — 4 a 5× mais que o horário fictício.
  - Os campos **não vêm pré-preenchidos** de propósito.

### 🚀 Funcionalidades Adicionadas
- **Fila de revisão dentro do modal da grade**: as batidas registradas fora da janela aparecem em âmbar, com um botão que joga o horário real no campo correspondente — o coordenador não redigita.
- **`fn_registrar_ponto`**: nova entrada oficial do terminal. Envolve `fn_confirmar_presenca` sem reescrevê-la e devolve `tipo = sucesso | alerta | erro`.
- **`fn_registrar_presenca_informada`**, **`fn_marcacoes_pendentes_revisao`** e **`fn_aceitar_marcacao_pendente`**: registram o horário real, nunca o previsto, e preservam a marcação original como tratamento append-only.

### 🔍 Observações
- `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` **não foram alteradas**. Todo o comportamento novo entra por funções que as envolvem — decisão tomada por causa das seis regressões já registradas nessas duas funções.
- **Exposição residual conhecida**: a validação **em massa** continua gravando horário derivado da jornada. Faz sentido para ausências justificadas, não para afirmar horários cumpridos; tratamento previsto para uma versão futura.
- Folhas já geradas mantêm o que têm. A mudança aparece em nova geração ou sincronização.

---

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
