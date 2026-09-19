# O lote que não cabia no próprio timeout (19/09/2026)

> **Resumo de uma linha:** o REP-iDClass-HMI-01 ficou 38 horas sem ingerir nenhuma batida, com
> 509 marcações presas no equipamento, enquanto a tela de Marcações mostrava *Online* e um NSR
> alto — e a falha se apagava a si mesma a cada 5 minutos.

## O relato

O usuário relatou, em 19/09/2026, que os servidores da CME do HMI apareciam sem marcação no dia
18. Uma análise prévia (feita com outra ferramenta) concluiu corretamente que havia uma lacuna de
**exatamente 500 NSRs** e que o relógio físico tinha gravado tudo, mas atribuiu a causa a *"erro
de transmissão, lote retido na fila offline local"*.

**A lacuna era real. A causa não era essa** — e a diferença importa, porque a causa apontada se
resolveria sozinha (a fila reenvia a cada ciclo) e a real **nunca** se resolveria.

## O que os dados diziam

Três medições derrubaram a hipótese do lote retido:

| medição | resultado |
|---|---|
| `rep_sincronizacoes` com status ≠ `concluida` para o dispositivo | **zero**, em todo o histórico |
| `dispositivos_rep.ultimo_contato_em` | **14:14 do próprio dia 19** — o coletor estava vivo |
| `coletor_versao_em` | **14:14:21** — o POST de marcações estava *chegando e sendo aceito* |

O terceiro é o que fecha o caso. A rota só grava `coletor_versao` **depois** de `fn_ingerir_afd`
retornar sem erro; e `dispositivos_rep.updated_at` (que a função escreve no caminho normal)
continuava em 11:39. Só um caminho produz esse par: o **atalho de reenvio idempotente**, em que a
função encontra o `lote_id` já ingerido e retorna cedo.

Ou seja: a cada ciclo o coletor mandava **dois** lotes — o de 500 linhas, que morria, e o de 10,
que era reenvio de algo já ingerido. O segundo deixava rastro de sucesso; o primeiro não deixava
rastro nenhum.

## A causa, medida

`fn_ingerir_afd` **reconcilia dentro da própria transação** (passo 3.6, desde `20260818080000`),
um `fn_reconciliar_pessoa_dia` por par (servidor, dia). E a rota `/api/rep/v1/marcacoes` chamava
`reconciliarSincronizacaoAfd` **depois**, que refazia exatamente o mesmo conjunto — por HTTP, um
RPC de cada vez, sequencialmente. Trabalho duplicado desde 18/08/2026, quando a função ganhou o
passo 3.6 e ninguém removeu o helper que o antecedia.

Medido na recuperação manual: **~3s por lote de 50 linhas**, ou seja ~30s para um lote de 500 só
na função. O AFD faltante tinha 509 batidas de **244 pessoas** em 3 dias civis — na casa dos 390
pares. Somando o laço da rota, o tempo de resposta passava dos **60s de timeout do cliente Go**.

A partir daí a sequência é mecânica:

1. o cliente aborta em 60s;
2. a conexão cai e o Postgres **reverte a transação inteira** — inclusive a linha de
   `rep_sincronizacoes` que registraria a tentativa;
3. o cursor (`fn_cursor_afd_dispositivo`, fim do trecho **contíguo** + 1) continua correto,
   apontando para 130690;
4. cinco minutos depois o coletor rebaixa o mesmo trecho, monta **o mesmo lote de 500** e bate no
   mesmo timeout.

**Laço eterno. Nada avança, nada reclama, nada fica registrado.**

### Por que só agora, se o mesmo relógio já tinha ingerido lotes de 500

Ele ingeriu, em **07/09** e **14/09**, lotes de 500 linhas com 500 marcações com dono — e
concluíram. O que mudou entre 14 e 18/09 foi a `20260917170000`, aplicada em **17/09**, que
trocou `fn_reconciliar_marcacoes_dia` por `fn_reconciliar_pessoa_dia` dentro de `fn_ingerir_afd`
(ela reconcilia também os cadastros irmãos, e é mais cara). **A lacuna começa em 17/09 às 18:44.**

A correção de 17/09 está certa e não foi desfeita. O que ela revelou é que o custo da ingestão
não tinha teto nenhum.

## O que tornou tudo invisível

Nenhuma tela do SisEscala mostrava lacuna de NSR. A aba Dispositivos REP mostrava, lado a lado:

- `NSR: 131199` — o maior já recebido, número alto e tranquilizador. **Ele não cai quando surge um
  buraco atrás dele.**
- `Último contato: há 2 minutos` — verdade, e irrelevante: o heartbeat funcionava.

Os dois indicadores existentes apontavam para "está tudo bem", e o banco **sabia** da lacuna o
tempo todo: `fn_cursor_afd_dispositivo` devolvia 130690 contra `ultimo_nsr` 131199. Ninguém
comparava os dois números.

## A recuperação

Alcancei o equipamento pela rede (10.110.5.5 responde em 2 ms da SMS — a rede 10.110.x.x é
roteada entre unidades), baixei o AFD a partir do NSR 130690 e ingeri **em lotes de 50** —
justamente o tamanho que cabe.

```
510 linhas · 11 lotes · ~3s cada
TOTAL: novas=510 marcacoes=509 orfas=0 falhas=0
```

**244 de 244 identificadores resolveram para servidor — zero órfãs.**

| medida | antes | depois |
|---|---|---|
| lacuna de NSR | 500 registros | **zero** (1.200 contíguos) |
| batidas do dia 18 no HMI-01 | **0** | **267** |
| dias de escala sem presença (17) | 50 | 9 |
| dias de escala sem presença (**18**) | **106** | **8** |
| dias de escala sem presença (19, em curso) | 105 | 51 |

A reconciliação da escala foi automática: veio de dentro da própria `fn_ingerir_afd`, sem nenhuma
chamada extra — o que, de quebra, **prova empiricamente que o passo 3.6 está vivo em produção** e
que o helper da rota era mesmo redundante.

Dos remanescentes, **zero** têm ganho a recuperar: projetando os 294 pares (servidor, dia) dos
dias 17 e 18, saíram **0 acréscimos puros** e 5 casos de troca, que por regra vão para a validação
manual do coordenador (não se reconcilia em massa — 19/08 e 03/09/2026). Os demais são Sobreaviso
(que nunca marca presença, por construção) e ausências reais.

## As correções

### 1. A reconciliação duplicada saiu

`src/utils/reconciliacaoHelper.ts` foi removido, e com ele os dois chamadores (a rota do coletor e
a importação por pendrive). Corta ~metade do tempo de resposta da ingestão, e o que sai é
estritamente pior que o que fica: o helper usava `fn_reconciliar_marcacoes_dia`, e o passo 3.6 usa
`fn_reconciliar_pessoa_dia`, que é a versão completa.

### 2. Lote adaptativo no coletor (v0.18.0)

- tamanho padrão de **500 → 150**;
- ao falhar **por transporte**, o trecho é dividido ao meio e cada metade é tentada,
  recursivamente, até um piso de 25 linhas;
- recusa que o **servidor respondeu** (401, 403, 400) **não** é refatiada — dividir não muda o
  resultado e só multiplicaria as tentativas de uma falha sistemática, prendendo o ciclo, que
  divide uma goroutine com o menu da bandeja;
- o laço **para no primeiro trecho que não entra**, em vez de seguir para o próximo: os lotes são
  contíguos em NSR, e mandar o posterior enquanto o anterior falha é exatamente o que cria a
  lacuna;
- o reenvio da fila offline passa pelo mesmo fatiamento — é o que destrava os lotes de 500 que
  versões anteriores já gravaram em campo.

Portão: `go test ./ciclo/` (`fatiamento_test.go`), validado injetando **4 regressões** — todas
reprovam.

### 3. A lacuna ficou visível — por ESTADO, não por evento

`fn_lacunas_afd_parque()` (`20260919100000`) compara `ultimo_nsr` com o cursor e devolve, por
relógio, quantos registros faltam e **desde quando**. A aba Dispositivos REP ganhou um selo por
equipamento e um aviso no topo com a lista.

🚨 **É esta a defesa que vale para a próxima causa, qualquer que seja ela.** Detecção por *evento*
não funciona quando a falha é capaz de reverter o próprio registro dela — ninguém conseguiu
escrever "falhei" porque a transação que escreveria isso foi desfeita. Um **estado inconsistente**
não depende de nada ter sido gravado no momento da falha.

⚠️ O texto diz explicitamente que **não há ponto perdido**: o AFD é memória inviolável do REP-C, e
o dado entra assim que a coleta destravar. Escrever "batidas perdidas" mandaria alguém digitar
horário à mão em cima de batida que existe.

## Varredura do parque

Dos **35 relógios ativos**, apenas o HMI-01 estava travado. Os outros 34 tinham cursor exatamente
em `ultimo_nsr + 1`.

## Notas

- O ensaio em homologação pegou dois defeitos que leitura de código não pegaria:
  `rep_afd_registros.hash_encadeado` é `NOT NULL` (armadilha 1: restrição de coluna só aparece na
  execução) e o `DELETE` na tabela é recusado pelo trigger de imutabilidade — o que está certo,
  Portaria 671/2021. **5 de 5 cenários**, revertidos.
- `fn_pode_reconciliar_presenca` devolve **NULL** para `service_role`, então
  `fn_reconciliacao_pendente_escala` devolve lista vazia por esse caminho. Não é bug (o filtro
  fecha), mas invalida a função como ferramenta de medição via script — a medição dos
  remanescentes teve de ser feita com `fn_projecao_marcacoes_dia`.
- A cadeia de hash de `rep_afd_registros` desses 510 registros não acompanha a ordem de NSR: ela é
  montada na ordem de chegada, e as 10 últimas linhas já estavam lá. É a observação já registrada
  em 17/08/2026 — não afeta o artefato legal (`linha_bruta` é o que veio do equipamento), mas a
  cadeia não serve como prova de sequência contínua nesse trecho.
