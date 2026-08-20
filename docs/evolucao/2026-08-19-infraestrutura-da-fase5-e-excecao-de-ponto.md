# Infraestrutura da Fase 5, triagem do portão e exceção de ponto — 19–20/08/2026

Sessão de levantamento do estado real do módulo REP em produção, seguida de três migrations que
completam a infraestrutura da Fase 5. Autorização de leitura e escrita em produção concedida pelo
usuário no início.

## O ponto de partida estava desatualizado

O `CLAUDE.md` descrevia a Fase 4 como não fechada, a SMS como bloqueada por identificador PIS e
`rep_vinculos_servidor` como "a única ponte". Medição em produção mostrou outra coisa.

| medido em 19/08/2026 | valor |
|---|---|
| relógios ativos | **6** |
| registros AFD | 414.301 |
| sincronizações (falhas nas últimas 1.000) | 1.514 (**0**) |
| marcações `rep` | 402.086 (400.621 órfãs, histórico de relógios reaproveitados) |
| vínculos | 486 (240 com biometria, 246 sem) |
| linhas de `escala_diaria` de 08/2026 com entrada `rep` | 408 |

Rampa de adoção: 2 batidas/dia em 07/08 → **441 batidas de 169 servidores em 6 relógios em 19/08**.

**A crise da SMS acabou.** Os 6 relógios têm `sem_vinculo = 0`, `fora_do_relogio = 0` e
`batidas_perdidas = 0`. O gargalo virou **biometria presencial**: 93 dos 267 escalados, sendo 42 só
no Almox-Pat-CAF.

## A Fase 4 deixou de ser "sem afetar a folha"

`20260818080000` fez `fn_ingerir_afd` chamar `fn_reconciliar_marcacoes_dia` automaticamente. A
batida do relógio já escreve em `escala_diaria`, em qualquer unidade, **sem corte e sem forma de
reverter por unidade** — porque `unidades.fonte_ponto_oficial` **nunca tinha sido criada**. Existia
só em comentários da `20260808060000`.

## Triagem do portão: 56 divergências, todas explicadas

`fn_conferir_reconciliacao` dava timeout na faixa inteira; rodado em 6 faixas, o total real é 56.

| causa | qtd | veredito |
|---|---:|---|
| resíduo temporal (linha reconciliada antes das migrations de 19/08) | ~18 | explicada |
| dado legado sem origem, pré-v1.22.0 | 13 | explicada |
| dia corrente / servidor ainda não bateu a saída | ~13 | **não é defeito** |
| plantão noturno cruzando meia-noite | ~6 | conhecido, já endereçado |
| batida REP com dono fora da folha | 2 pares | bug real, corrigido |

⚠️ **Reconciliar 08/2026 em massa foi medido e descartado.** Sobre os 54 dias com
`intervalo_retorno` preenchido e `saida` vazia, a projeção **concorda com o gravado em 50**;
preencheria a saída em 4 e **deixaria a entrada vazia em 11**. Corrigiria 4 e pioraria 11. O
terminal preenche sequencialmente, a projeção aloca por proximidade — nenhuma das duas é
uniformemente melhor.

⚠️ **50 dos 54 não eram defeito nenhum, e 26 eram do próprio dia corrente.** Antes de chamar de bug
um padrão em `escala_diaria`, separe o dia em aberto.

## Batida com dono que nunca chega à folha

Dos 580 pares (servidor, dia) com batida REP em agosto: 493 reconciliados, 85 fora de escala
(esperado) e **2 com dono e fora da folha**. SAMANTA (CEI, 18/08) tinha 3 batidas do relógio
(12:01, 13:57, 17:00) ausentes da folha — reconciliada nesta sessão, com a entrada continuando
vazia (ela não bateu, e o sistema não fabrica).

**A causa é estrutural:** a auto-reconciliação só dispara **na ingestão do lote**. Vínculo criado
depois de a batida já ter entrado deixa a batida com dono e fora da folha, em silêncio nas duas
pontas. O próprio comentário de `fn_vincular_cadastros_por_cpf` admitia: *"batidas passam a ter dono
num FUTURO `fn_reparse_afd_dispositivo`"* — e nenhum caminho chamava esse futuro.

## As três migrations da Fase 5

| migration | o que faz |
|---|---|
| `20260820000000` | cria `unidades.fonte_ponto_oficial` (`terminal`/`rep`, default `terminal`) e o trigger de guard |
| `20260820010000` | criar vínculo aciona o reparse; **e o reparse passa a reconciliar só os pares que ganharam dono**, não o mês inteiro do dispositivo |
| `20260820020000` | em unidade `rep`, escrita direta **neutralizada**; marcação dispara reconciliação com precedência |

A parte 1 da `20260820010000` é pré-requisito da parte 2: sem ela o trigger viraria a reconciliação
em massa que acabara de ser medida como prejudicial.

⚠️ **O motivo da `20260820020000`:** dos 580 pares com batida REP, **41 ficaram com entrada de
origem `terminal` e 8 com `ajuste_coordenador`** — em 49 dias o REP perdeu para quem está abaixo
dele em `fn_precedencia_origem`, porque `fn_confirmar_presenca` escreve `escala_diaria` direto. E
105 dias de 08/2026 já têm batida das duas fontes, então deixou de ser hipotético.

**Decisão de desenho (usuário):** neutralizar em silêncio, não abortar. `fn_confirmar_presenca`
(1.030 linhas, seis regressões históricas) **não foi tocada** — todo o comportamento entra por
triggers em volta. Os 16 campos de presença voltam juntos, porque reverter só os timestamps
deixaria a linha incoerente.

## A premissa do corte da Fase 5 caiu

O plano mandava começar por unidade **sem** marcação de intervalo. Medido: **as 4 unidades com
relógio marcam intervalo** (CEI, LACEM, SMS `flexivel`; ENF-ZEZINHA `rigido`). O critério virou
**cobertura**, e o CEI é o único com 100%. Roteiro em
[`docs/planos/2026-08-20-virada-do-cei-fase5.md`](../planos/2026-08-20-virada-do-cei-fase5.md).

Simulação da virada sobre os 359 dias-linha do CEI: **169 idênticos, 9 mudariam**, todos de um
servidor com Regular + Plantão no mesmo dia — e as 9 são **correções** da duplicação descrita na
armadilha 6, não perdas.

## Estar cadastrado num relógio basta para virar ponto

O achado mais sério da sessão, e o motivo da `20260820030000`. Detalhado na **armadilha 13** do
`CLAUDE.md`: `fn_servidor_por_identificador_afd` resolve por CPF/PIS direto em `servidores`, sem
exigir vínculo. O administrador, que precisa estar cadastrado em todos os equipamentos, teve um
teste de biometria no CEI (15/08, 11:24) virar a **entrada do Plantão dele na folha** — sem ter
vínculo naquele relógio.

## Também nesta sessão

- **Almox-Pat-CAF validado como CPF** antes do mutirão de biometria: 48 vínculos e 49 usuários no
  snapshot, **100% CPF válido, zero PIS**. Confirmado pelo usuário: cadastro todo enviado pelo
  SisEscala, sem reaproveitamento do equipamento anterior.
- **Dados fiscais** (Fase 9): CNPJ `18478187000107` e razão social preenchidos nas **18 unidades**
  (uma estava sem CNPJ). Falta `responsavel_nome/cpf/cargo`, que o usuário preencherá por unidade.
- **Nenhum usuário de teste esquecido** nos 6 relógios (varredura por `SISESCALA*`).

## Pendências abertas

- **Biometria: 93 servidores** — 42 no Almox (mutirão em 20/08), 24 SMS, 13 ENF-ZEZINHA, 13 TI, 1 LACEM.
- **4 coletores atrasados**: SMS, LACEM e ENF-ZEZINHA em `0.6.1`; CEI em `0.7.0` (atual: `0.8.0`).
- **`reconciliacao_versao` nunca versionou** — 0 linhas com versão > 1. A projeção mudou 4 vezes só
  em 19/08 e não há como detectar linha desatualizada sem rodar o portão.
- **A folha de 15/08 do administrador** continua com o teste do CEI como entrada do Plantão. A
  `20260820030000` **não corrige o passado**.
- **77 dias** com batida REP e entrada de origem nula, não investigados.
