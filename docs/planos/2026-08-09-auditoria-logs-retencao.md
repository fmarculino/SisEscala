# Auditoria, logs e retenção — levantamento e proposta

**Data:** 09/08/2026
**Origem:** pedido de revisar o que é registrado, o que está visível na Auditoria, o que ainda
falta registrar, e como tratar limpeza e backup.
**Estado:** estudo. **Nada implementado.**

Todos os números vêm de medição em **produção** em 09/08/2026, não de estimativa.

---

## 1. A premissa do espaço está invertida — e isso muda a prioridade

O pedido partiu de "logs costumam ocupar espaço considerável". Medido:

| tabela | linhas | bytes/linha | total | crescimento |
|---|---|---|---|---|
| `escala_diaria` | 6.510 | 1.193 | **7,41 MB** | — |
| `marcacoes_ponto` | 7.183 | 667 | **4,57 MB** | 4.751/mês ≈ **36 MB/ano** |
| `folha_ponto` | 319 | 13.320 | **4,05 MB** | — |
| `logs_sistema` | 2.995 | 334 | 0,95 MB | 1.512/mês ≈ 5,8 MB/ano |
| `logs_tentativas_presenca` | 981 | 714 | 0,67 MB | 698/mês ≈ 5,7 MB/ano |
| `logs_sobreaviso` | 522 | 1.215 | 0,60 MB | 182/mês ≈ 2,5 MB/ano |
| `historico_transferencias` | 16 | 483 | 0,01 MB | ≈ 0,1 MB/ano |
| `rep_afd_registros` | 26 | 746 | 0,02 MB | ainda em piloto |
| `logs_webhook_whatsapp` · `avisos_ponto_fila` · `logs_preferencia_aviso_ponto` | 8 | — | 0,02 MB | recém-criadas |
| **total medido** | | | **18,3 MB** | |

**Dezoito megabytes.** O sistema inteiro, três meses de operação. Todos os *logs* somados crescem
**~14 MB/ano** — apagá-los economizaria menos que uma foto de celular por mês, em troca de perder
rastreabilidade.

**O que cresce de verdade é `marcacoes_ponto`: 36 MB/ano — e ela não é log, é registro de ponto.**
Vai multiplicar quando o REP entrar (a Fase 9 prevê AFD de toda a rede) e quando as outras 11
unidades passarem a usar o terminal. Hoje 5 de 16 unidades usam; se todas usarem, o volume atual de
~4.750 marcações/mês vira algo próximo de **16.000/mês**.

> **A conclusão prática inverte o pedido:** não há problema de espaço a resolver. Há um problema de
> **lacuna de registro** — e a política de retenção que interessa não é sobre economizar disco, é
> sobre **quanto tempo a lei obriga a guardar** e **o que nunca pode ser apagado**.

---

## 2. O que a Auditoria mostra hoje

Quatro abas em [`/auditoria`](<../../src/app/(dashboard)/auditoria/page.tsx>), o grupo inteiro
oculto para coordenadores desde a v1.2.1:

| aba | fonte | quem vê |
|---|---|---|
| Sobreaviso | `logs_sobreaviso` (categoria Sobreaviso/nula) | admin, super_admin |
| Presença Regular | `logs_sobreaviso` (categorias Regular/Extra/Plantão) | admin, super_admin |
| Sistema | `logs_sistema` | admin, super_admin |
| Tentativas Negadas | `logs_tentativas_presenca` | **super_admin apenas** |

**Existem 11 fontes de trilha no banco; a Auditoria expõe 3.** Ficam de fora, sem nenhuma tela:

`marcacoes_ponto` · `marcacoes_tratamentos` · `historico_transferencias` ·
`rep_afd_registros` · `logs_preferencia_aviso_ponto` · `avisos_ponto_fila` ·
`logs_webhook_whatsapp` · `servidores_eventos`

⚠️ **Nota sobre a aba "Presença Regular":** ela lê `logs_sobreaviso`, que segundo o CLAUDE.md contém
**509 artefatos** de validação manual e terminal contra apenas 13 acionamentos reais. A aba
funciona por acidente feliz — os artefatos *são* o registro de validação. Mas depender de uma tabela
chamada `logs_sobreaviso` para auditar presença é frágil.

---

## 3. O que **não** é registrado — as lacunas

Medido por varredura: `logs_sistema` é escrito em **7 arquivos**. Estes módulos têm **zero**
chamadas:

| módulo | operações sem nenhum log | gravidade |
|---|---|---|
| `servidores/actions.ts` | cadastrar, editar, **trocar PIN**, inativar, importar CSV em massa | 🔴 |
| `usuarios/` | criar usuário, **mudar papel**, conceder `acesso_todas_unidades`, inativar | 🔴 |
| `configuracoes/` | alterar qualquer parâmetro global, **fechar/reabrir competência**, trocar credenciais de WhatsApp/SMTP | 🔴 |
| `folha-ponto/actions.ts` | **editar horário na folha oficial**, fechar, reabrir, regerar | 🔴 |
| `consultar-escala/actions.ts` | tudo que o servidor faz no Portal | 🟡 |
| `unidades/` · `setores/` | criar, editar, inativar, mudar geofence, mudar canal de comunicação | 🟡 |
| `ferias-licencas/` | deferir, indeferir, contrapropor | 🟡 |

### As quatro mais graves, e por quê

**1. Validação manual de presença não aparece em `logs_sistema`.** Há **1** registro de
`VALIDACAO_MANUAL_SOBREAVISO` em 2.995 linhas. A trilha existe, mas espalhada:
`marcacoes_ponto.coordenador_id` + `justificativa`, `marcacoes_tratamentos.registrado_por_id`, e os
artefatos em `logs_sobreaviso`. **Nenhuma dessas está na Auditoria.** Quando alguém perguntar
"quem declarou o horário deste servidor?", a resposta exige SQL.

Isto é o Art. 82, parágrafo único, da Portaria 671 — tratamento autorizado *desde que rastreável*.
A rastreabilidade existe no dado; falta a tela.

**2. Edição da folha de ponto — o documento legal — não tem histórico.** `folha_ponto` guarda
`ultima_edicao_por_id` e `ultima_edicao_em`: **só a última**. Os horários vivem num `jsonb`
(`registros`) sobrescrito inteiro a cada salvamento. Não há como saber que a entrada do dia 12 era
`08:03` e virou `08:00`, nem quem fez. É a peça que vira prova em processo.

**3. Mudança de papel e de permissão não é registrada.** Conceder `acesso_todas_unidades` a alguém
amplia o alcance sobre dados de 183 servidores, e não deixa rastro. É o item mais clássico de
qualquer auditoria de sistema, e é o único que permite responder "quem deu esse acesso, e quando".

**4. Fechamento e reabertura de competência não é registrado.** `toggleCompetencyClosure` congela ou
descongela um mês inteiro de folha. Reabrir uma competência fechada é exatamente o movimento que
uma auditoria quer ver documentado — e hoje é invisível.

### Lacuna transversal: não se registra o **antes**

Onde há log, ele diz o que foi feito, não o que mudou. `SALVAR_PREVISAO_ESCALA` (624 ocorrências)
não guarda o estado anterior. Para escala isso é aceitável — a grade é planejamento. Para **folha de
ponto e cadastro de servidor**, valor anterior é o que dá sentido à auditoria.

### Cobertura de autoria

`user_id` preenchido em **2.592 de 2.995** (86,5%). Os 403 sem autor são majoritariamente as
rotinas automáticas (`Folha de Ponto Fechada Automaticamente`, 269 + 134) — correto, não têm autor
humano. **Mas não há como distinguir "rotina automática" de "falhou ao capturar o autor"**, porque
não existe campo de origem.

---

## 4. Critério: o que merece log

Nem tudo merece. O critério que proponho, em uma frase:

> **Registra-se o que altera direito, dinheiro ou acesso — e o que alguém pode precisar contestar.**

| categoria | exemplos | registrar? |
|---|---|---|
| **Altera registro de ponto** | validação manual, edição de folha, ajuste aceito, fechamento de competência | ✅ sempre, **com valor anterior** |
| **Altera acesso** | criar usuário, mudar papel, conceder escopo, reset de PIN | ✅ sempre |
| **Altera identidade** | cadastro/edição de servidor, matrícula, CPF, telefone, lotação | ✅ sempre, com valor anterior |
| **Altera regra do sistema** | configurações globais, janela de presença, canal de comunicação | ✅ sempre |
| **Decisão sobre pedido** | deferir férias, aprovar troca, aceitar ajuste do servidor | ✅ sempre |
| **Planejamento** | salvar previsão de escala, aplicar template | 🟡 já registra; sem valor anterior está ok |
| **Consulta / leitura** | abrir tela, gerar relatório | ❌ não — ruído, e não altera nada |
| **Sessão** | login, logout | 🟡 mantém; é 40% do volume e tem valor limitado |

**O que eu tiraria:** nada. Mesmo LOGIN/LOGOUT (1.195 linhas, 40% do total) custa 0,4 MB — barato
demais para valer a discussão.

---

## 5. Retenção: separar **log** de **registro legal**

Esta é a distinção que a política inteira depende, e ela não é sobre espaço.

### Não pode ser apagado — é o registro, não o log

| tabela | por quê |
|---|---|
| `rep_afd_registros` | evidência bruta do REP-C, **cadeia de hash**. Portaria 671: o PTRP não pode alterar nem eliminar o dado original |
| `marcacoes_ponto` | **INSERT-only por trigger**. É o fato registrado pelo servidor |
| `marcacoes_tratamentos` | append-only. É o juízo do coordenador sobre o fato |
| `escala_diaria` · `escala_mensal` | base do cálculo de jornada |
| `folha_ponto` | o documento oficial |
| `logs_preferencia_aviso_ponto` | prova de consentimento LGPD — some junto com o direito de comprová-lo |

**Prazo:** a prescrição trabalhista é de **5 anos** (CF Art. 7º XXIX). Para servidor estatutário o
prontuário funcional costuma exigir mais. **Recomendo 5 anos como piso e nenhuma exclusão automática
— só arquivamento.**

### Pode ser expurgado

| tabela | proposta | economia |
|---|---|---|
| `logs_sistema` — LOGIN/LOGOUT | 12 meses | ~0,4 MB/ano |
| `logs_sistema` — demais ações | 5 anos (acompanha o ponto) | — |
| `logs_webhook_whatsapp` | **90 dias** — é diagnóstico, e mesmo filtrado carrega texto de mensagem | ~0,1 MB/ano |
| `avisos_ponto_fila` — status `enviado` | 90 dias; **`falha` guarda 12 meses** (é o que responde "não recebi") | pequena |
| `logs_tentativas_presenca` | ⚠️ **não expurgar antes de 5 anos** — já foi usada para recuperar horário real de batida recusada por bug. É evidência, não ruído | — |

### Backup

O ponto que importa: **hoje não existe backup próprio do SisEscala**. O banco é um Supabase
self-hosted na VPS Coolify — o que existe é o backup da VPS, se houver.

Para dado que a lei obriga guardar por 5 anos, isso é frágil demais. O mínimo defensável:

1. **Dump lógico periódico** das tabelas de registro legal (as seis da lista acima), fora da VPS.
2. **Export assinado do AFD** por competência — o `rep_afd_registros` já tem cadeia de hash;
   exportar e guardar o arquivo original preserva a prova.
3. **Conferência de restauração** ao menos uma vez. Backup nunca testado não é backup.

---

## 6. Proposta priorizada

| # | ação | esforço | por quê agora |
|---|---|---|---|
| 1 | **Helper único de auditoria** (`fn_registrar_log` ou util TS) com autor, ação, entidade, id, **valor anterior** e origem (humano/rotina) | médio | sem isso, cada novo log repete o problema; hoje são 7 implementações soltas |
| 2 | **Logar as 4 lacunas graves**: papel/permissão, configurações + competência, edição de folha, cadastro de servidor | médio | são as que uma auditoria pede primeiro |
| 3 | **Aba "Avisos de Ponto"** na Auditoria (consentimento + fila + falhas), super_admin | baixo | já pedido; a trilha existe e ninguém enxerga |
| 4 | **Alinhar RLS ao que a tela restringe** | baixo | restringir só na UI não restringe — as policies hoje liberam `SELECT` a coordenadores |
| 5 | **Aba "Marcações e Tratamentos"** — quem declarou horário de quem | médio | é o Art. 82 em forma de tela |
| 6 | **Política de retenção** como configuração + rotina no worker que já roda | baixo | o worker de avisos já roda de minuto em minuto |
| 7 | **Backup lógico externo** das 6 tabelas de registro legal | médio | é a lacuna de maior consequência e a menos visível |

**Não recomendo** começar pelo expurgo. Economizaria ~14 MB/ano e criaria buracos de rastreabilidade
num sistema que ainda tem lacunas de registro maiores que o problema de volume.

---

## 7. Execução — decisões tomadas e fases

O usuário informou em 09/08/2026 que **a aba mais usada é "Tentativas Negadas"**, e para um fim
operacional: descobrir por que uma batida foi recusada e **corrigir a escala**. Isso reordena a
prioridade — a Auditoria aqui não é só conformidade, é ferramenta de diagnóstico. Melhorar o que já
se usa vale mais que completar o que ninguém abriu.

### Decisões assumidas (corrija se discordar)

| # | decisão | escolha | por quê |
|---|---|---|---|
| 1 | escopo | **as 4 lacunas graves** | "todos os logs são importantes numa auditoria" |
| 2 | valor anterior | **diff só dos campos que mudaram** | a linha inteira infla o log e esconde a mudança no meio do que ficou igual |
| 3 | quem vê | **super_admin**, como a aba Tentativas Negadas | consistente com o que existe; ampliar depois é fácil, reduzir não |
| 4 | retenção | **5 anos** para tudo que toca ponto; expurgo só de LOGIN/LOGOUT e webhook | prescrição trabalhista (CF Art. 7º XXIX) |
| 5 | backup | **especifico, não implemento** | é infraestrutura da VPS, fora do código |

⚠️ **Campo sensível nunca vai com valor.** PIN e credenciais são registrados como *alterados*, sem
o conteúdo — o log precisa provar que o PIN mudou e não pode conter o PIN.

### Fases

| fase | o que | estado |
|---|---|---|
| **A** | `logs_sistema` ganha `entidade`, `entidade_id`, `origem`, `alteracoes` + índices + `fn_trilha_auditoria`; helper `src/utils/auditoria.ts` | ✅ migration `20260809180000` |
| **B** | instrumentar as 4 lacunas: permissões, configurações/competência, folha de ponto, cadastro de servidor | ⬜ |
| **C** | **melhorar a aba Tentativas Negadas** — é a que se usa | ⬜ |
| **D** | aba nova "Avisos de Ponto" (consentimento + fila + falhas) | ⬜ |
| **E** | RLS alinhado ao que a tela restringe | ⬜ |
| **F** | retenção configurável, drenada pelo worker que já roda | ⬜ |

### Fase C — o que muda na aba que ele usa

Hoje a aba lista linhas cruas de `logs_tentativas_presenca`. A auditoria de 07/08/2026 mostrou que
**378 das 911 tentativas são `Matrícula ou PIN inválidos`** — erro de digitação, não problema de
escala. Elas afogam o que interessa.

| melhoria | por quê |
|---|---|
| separar **"problema de escala"** de **"erro de identidade"** | é a distinção que o `fn_batidas_reais_recusadas` já formaliza; a tela não a usa |
| exibir **previsto × tentado**, com a diferença em minutos | a diferença *é* o diagnóstico — 30 min é tolerância, 6 h é escala errada |
| **agrupar por servidor + dia** | quem é recusado tenta 3, 4 vezes; hoje viram 4 linhas do mesmo problema |
| link direto para a **grade daquele servidor/mês** | fecha o ciclo diagnóstico → correção sem busca manual |

---

## 8. Decisões que preciso de você

1. **Escopo do item 2** — logar as 4 graves, ou começar só por permissões e competência?
2. **Valor anterior**: guardar o *diff* (mais útil, mais complexo) ou só o valor novo?
3. **Coordenador vê falhas de envio da própria lotação?** (§ 6 item 3 — muda o RLS)
4. **Retenção**: aceita 5 anos como piso para tudo que toca ponto, com expurgo só de
   LOGIN/LOGOUT e webhook?
5. **Backup**: quer que eu especifique a rotina de dump externo, ou isso fica com a
   infraestrutura da VPS?
