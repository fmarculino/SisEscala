# Dispensa de registro de ponto autorizada pelo RH Geral

**27/08/2026 — proposta, nada implementado.**

Origem: Ofício nº 249/2026/SMS-PRO-ESP/SMS-PMM (Processo 050505164.000160/2026-10), da
Coordenação de Programas Especiais à RH da Diretoria de Atenção Básica, pedindo **dispensa do
registro biométrico de entrada** para 7 técnicos de enfermagem do **Programa Porta a Porta**.

O ofício é preciso sobre o que pede e sobre o que **não** pede:

> "as atividades do programa iniciam-se de madrugada, às 04h30 e outros dias as 06h00 (…) os
> motoristas buscam os profissionais diretamente em suas residências (…) tornando inviável o
> deslocamento até a sede da SMS apenas para registrar o início da jornada."
>
> "**permanece a total obrigatoriedade do registro do ponto biométrico no horário de saída**
> (final do expediente), o qual deverá ser realizado rigorosamente na sede da SMS."

---

## 1. O que o sistema faz hoje com esse caso

Nada previsto. As três saídas existentes são todas ruins:

| saída atual | por que não serve |
|---|---|
| coordenador valida manualmente todo dia | é o que o usuário relatou como inviável: 22 dias úteis × 7 pessoas, todo mês, para sempre |
| lançar afastamento | **errado de fato**: a pessoa está trabalhando. Afastamento bloqueia o turno na escala (`fn_prevent_shift_during_event`, armadilha 14) e sairia na folha como ausência |
| justificativa por dia | mesmo volume do primeiro caso, e a justificativa passa a significar "rotina", perdendo o valor de exceção |

O custo do preenchimento manual já é grande no sistema inteiro — medido em produção, **agosto/2026**:

| medida | valor |
|---|---|
| marcações de origem `ajuste_coordenador` | **18.041** |
| pares (servidor, dia) validados à mão | **6.176** |
| servidores atingidos | 537 |
| média de passos gravados por dia validado | 2,9 |

O Porta a Porta ainda **não** entrou nesse fluxo: o setor existe (SMS → PORTA A PORTA, 10
servidores ativos), tem 10 escalas mensais de 08/2026 **todas em Rascunho**, com **zero** dias
lançados e **zero** marcações. A demanda é preventiva — chega junto com a escala.

⚠️ Três dos sete nomes do ofício não casaram por grafia com o cadastro
(GÉSSICA FRANCIELE ≠ "Gessica Francielle", e Luzinete Martins / Nídia Evilyn não estão lotadas
no setor). **Conferir a lista nominal com o RH antes de conceder qualquer dispensa** — a
autorização é por pessoa, não por setor.

---

## 2. O princípio que decide o desenho

O CLAUDE.md já registra a régua, e ela resolve este caso:

> **o sistema só preenche onde o servidor não tem como registrar.** Onde ele tem meio, preencher
> é fabricar.

E a regra dura do módulo de marcações:

> **Nunca fabricar horário.** Passo sem marcação vira pendência, não timestamp sintético.

As duas juntas dizem o que a solução **não** pode ser: nada de gerar uma entrada às 04h30 porque
a jornada começa às 04h30 — isso é exatamente a marcação automática por horário predeterminado
que a Portaria 671/2021 veda (vedação 2), e foi o que a v1.22.0 removeu do sistema.

**A solução correta não preenche o passo: ela deixa de exigi-lo.**

| o que se faz | o que NÃO se faz |
|---|---|
| o passo dispensado deixa de ser cobrado — não vira pendência, não vira falta, não pede validação | gravar `04:30` como horário de entrada |
| a folha imprime um rótulo — `DISPENSADO — Ofício 249/2026` | a folha exibir horário nenhum naquele campo |
| a autorização fica registrada com quem assinou, quando e com base em qual documento | a dispensa nascer de decisão de coordenador |

Isso mantém o sistema como **PTRP** da Portaria 671/2021: ele complementa e trata, e o registro
que existe (a saída) continua sendo o dado real, biométrico, no REP-C certificado.

---

## 3. Modelo proposto

### 3.1 Tabela `dispensas_registro_ponto`

| coluna | papel |
|---|---|
| `servidor_id` | **por pessoa**, nunca por setor — o ofício nomeia sete servidores |
| `passos` `text[]` | quais passos ficam dispensados: `entrada`, `intervalo_saida`, `intervalo_retorno` |
| `vigencia_inicio` / `vigencia_fim` | `fim` nulo = vigente até revogação. Toda leitura é **por data**, como `servidores_jornadas_temporarias` |
| `documento` | número do ofício/processo — **obrigatório**. É o que o fiscal vai pedir |
| `motivo` | texto livre, obrigatório |
| `autorizado_por_id` | o usuário de RH Geral que concedeu |
| `revogado_em` / `revogado_por_id` / `revogacao_motivo` | revogar, nunca apagar — é ato administrativo |

**Append-only, como `marcacoes_tratamentos`**: uma dispensa não se edita; corrige-se revogando e
concedendo outra. Sem isso não há como reconstruir o que valia num mês já fechado.

### 3.2 A saída nunca pode ser dispensada

`CHECK` no banco impedindo `saida` na lista de passos. Três razões:

1. é o que o próprio ofício preserva, e por escrito;
2. dispensar entrada **e** saída é deixar de haver controle de jornada, não flexibilizá-lo;
3. sem nenhum registro real no dia, a folha vira declaração pura — o que a Súmula 338 do TST trata
   como controle imprestável como prova.

### 3.3 Quem concede

**Só RH Geral (`rh`) e Administrador Geral (`super_admin`)** — conferido no banco, dentro da
função, não na tela (armadilha 12: server action e RPC são chamáveis direto). Coordenador,
Diretor e RH da Unidade **não** concedem: a autorização do ofício é endereçada à RH.

---

## 4. Onde isso encosta no código

| camada | mudança | risco |
|---|---|---|
| `fn_alocar_marcacoes_dia` / `fn_projecao_marcacoes_dia` | slot dispensado deixa de gerar pendência; os demais continuam iguais | baixo — é o lugar certo, a precedência já é resolvida ali |
| `fn_confirmar_presenca` | **nenhuma** — se a pessoa bater, a batida é aceita e vale. Dispensa não descarta batida | nenhum |
| geração de folha (as **4** cópias) | campo dispensado sai com origem própria `dispensado`, sem horário | médio — mexer nas quatro pelo mesmo critério, via script com contagem |
| recálculo de totais (as **outras 4** cópias) | como o trecho dispensado entra na carga horária — ver decisão D2 | médio |
| grade (`ScaleGrid`) | célula mostra o rótulo; o passo dispensado não pede validação | baixo |
| tela nova `/dispensas` (ou aba em Marcações) | conceder, revogar e listar vigentes, com o documento | baixo |

⚠️ **Se a pessoa bater no passo dispensado, o horário real vence.** Dispensa é permissão para não
registrar, não proibição de registrar — e a regra "nunca descartar batida" continua valendo.

---

## 5. Fases sugeridas

| fase | entrega | critério de saída |
|---|---|---|
| 1 | tabela + `fn_conceder_dispensa_ponto` / `fn_revogar_dispensa_ponto` / `fn_dispensa_vigente` + tela do RH | RH consegue conceder as 7 dispensas do ofício e vê-las listadas |
| 2 | reconciliação para de cobrar o passo dispensado | um dia real do Porta a Porta com só a saída batida deixa de aparecer como pendência |
| 3 | folha imprime o rótulo e o total fecha | folha de um mês do grupo, conferida à mão com o RH |
| 4 | relatório de dispensas vigentes (para responder fiscalização) | lista com servidor, passos, vigência e ofício |

**A fase 1 é inerte** — conceder dispensa não muda nada em folha até a fase 2 entrar. É de
propósito: dá para cadastrar e conferir antes de qualquer efeito sobre ponto real.

---

## 6. Decisões que dependem do usuário

**D1 — O que entra na carga horária no trecho dispensado?**
- (a) a **jornada prevista** para o trecho (é o que o RH quer na prática: quem tem dispensa não
  perde hora por ela). Fica rotulado como tratamento, nunca como batida;
- (b) contar **da saída real para trás** pela carga horária do dia;
- (c) não contar nada e deixar o total menor — na prática vira desconto, provavelmente indesejado.

**D2 — Dispensa de intervalo entra junto?** O ofício fala só de entrada. O usuário mencionou
"entrada, intervalos, só é exigido o registro do ponto final" — se for isso, os passos
dispensados são `entrada`, `intervalo_saida` e `intervalo_retorno`. Vale lembrar que o intervalo
já tem pré-assinalação própria onde a unidade não marca intervalo (CLT Art. 74 §2º), e a SMS
**marca** intervalo hoje.

**D3 — Prazo máximo de vigência.** Dispensa sem data de fim tende a virar permanente e ninguém
revisa. Sugestão: exigir `vigencia_fim` (ex.: até 12 meses), renovável por novo ato — isso força
a revisão periódica e é o que costuma ser cobrado em fiscalização.

**D4 — Conferir a lista nominal**: 3 dos 7 nomes do ofício não casam com o cadastro (seção 1).
