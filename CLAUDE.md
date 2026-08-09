# SisEscala — guia para agentes

Sistema de gestão de escalas e ponto digital da **Secretaria Municipal de Saúde de Marabá (DMAC)**.
**Está em produção com dados reais de servidores públicos.** Erros aqui viram folha de ponto errada
e problema jurídico. Prefira investigar demais a supor de menos.

Ver também [`.agents/AGENTS.md`](.agents/AGENTS.md) — regras que **complementam** este arquivo.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + RLS + Auth)
Sem framework de testes. `npm run build` e `npx tsc --noEmit` são a única verificação automática.
(`npm run lint` **não roda** — o ESLint nunca foi configurado e o comando abre prompt interativo.)

**Deploy: Coolify na VPS, não Vercel.** App em `sisescala.maraba.pa.gov.br`, mesmo host do
Supabase de produção. Webhook do GitHub dispara o deploy automático a cada push na `main`.
Uma nota anterior aqui dizia "Vercel" — os headers de produção não têm nenhuma assinatura da
Vercel, e isso já levou a afirmar que um push tinha deployado sem ter como verificar.

```
src/app/(dashboard)/     telas internas (escalas, folha-ponto, relatórios, cadastros)
src/app/consultar-escala portal do servidor (login por matrícula + PIN)
src/app/presenca         terminal de ponto
supabase/migrations/     60+ migrations SQL
docs/                    planos, evolução por versão, diagnósticos
```

## Onde mora a complexidade

**Não é no frontend.** A lógica crítica está em funções PL/pgSQL grandes:

| função | papel |
|---|---|
| `fn_confirmar_presenca` | ~1.030 linhas. Decide, a cada batida no terminal, **qual** dos 4 passos está sendo registrado (entrada → saída intervalo → retorno intervalo → saída), com janela de tolerância, blocos contíguos e turnos que cruzam a meia-noite. |
| `fn_confirmar_presenca_manual` | Validação manual pelo coordenador. Grava horários **sintéticos** derivados da jornada. |
| `fn_confirmar_presenca_manual_bulk` | Apenas um laço que **delega** para `fn_confirmar_presenca_manual`. Corrigir a função manual corrige a validação em massa junto. |
| `fn_jornada_tem_intervalo` | Fonte única da regra de intervalo intrajornada (CLT Art. 71). |

`ScaleGrid.tsx` (~5.000 linhas) é a grade de escala — o maior arquivo do frontend.

## Módulo de marcações (integração com relógio de ponto) — em construção

Iniciado em 08/08/2026. Plano em [`docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md`](docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md),
faseado de 0 a 9. **Fases 0–3 aplicadas em produção; a 4 está pela metade.**

O relógio é um **REP-C certificado** (Control iD iDClass, AFD assinado, memória inviolável) e o
SisEscala passa a ser o **PTRP** da Portaria 671/2021: pode complementar e tratar, **nunca**
alterar o dado original, e deve manter histórico.

### O modelo separa três coisas que hoje estão fundidas numa coluna só

| camada | tabela | mutabilidade |
|---|---|---|
| evidência bruta | `rep_afd_registros` | `linha_bruta` imutável, com cadeia de hash |
| o fato | `marcacoes_ponto` | **INSERT-only** — trigger bloqueia UPDATE/DELETE |
| o juízo do coordenador | `marcacoes_tratamentos` | append-only |
| projeção (cache) | `escala_diaria.presenca_*` | reconstruível por `fn_reconciliar_marcacoes_dia` |

Origem em `marcacao_origem`; a prioridade vem de `fn_precedencia_origem` (rep 1 → terminal 2 →
ajuste_coordenador 3 → ajuste_servidor 4) e é aplicada **em um único lugar**, a reconciliação.
Não replicar no frontend.

### Regras que não podem ser quebradas

- **Nunca fabricar horário.** Passo sem marcação vira pendência, não timestamp sintético. É o
  oposto de `fn_salvar_saida_bloco`, que inventa até 5 timestamps por batida.
- **Nunca descartar batida.** Órfã, excedente, duplicada e fora de escala continuam registradas.
- **Marcação perdedora por precedência continua visível** (`substituida_por_precedencia`).
- `fn_projecao_marcacoes_dia` é a **fonte única** compartilhada por reconciliar e conferir. Se
  cada uma derivar por conta própria, o portão de conferência deixa de validar o que será aplicado.

### Antes de mexer

`fn_blocos_previstos_dia` (`20260808040000`) é **cópia mecânica** do trecho de montagem de blocos
de `fn_confirmar_presenca`. Não editar à mão — regerar pelo script (`scratchpad/gen_blocos.js`),
que aborta se a contagem de ocorrências divergir.

`fn_conferir_reconciliacao` é o substituto do framework de testes: roda a projeção sobre meses
reais e devolve toda divergência. O portão da Fase 2 está registrado em
[`docs/evolucao/2026-08-08-portao-fase2-reconciliacao-de-marcacoes.md`](docs/evolucao/2026-08-08-portao-fase2-reconciliacao-de-marcacoes.md).

### Piloto da Fase 4 (definido em 08/08/2026)

6 servidores do setor de **Informática da SMS**, marcando **no relógio e no terminal** por um mês
— um par de controle por evento. O coordenador é participante e supervisiona.

**O mês só começa quando a coleta estiver contínua.** Em 08/08/2026 havia 1 dispositivo, 26
registros AFD e **2 marcações de origem `rep`** — a data de início não é a data em que a fase foi
marcada.

Duas lacunas conhecidas, registradas no plano:
- A SMS tem `permite_marca_intervalo = false` → o piloto exercita **só o fluxo de 2 batidas**.
  **A Fase 5 tem que começar por unidade sem marcação de intervalo**; as com intervalo exigem
  segundo piloto.
- Nenhum turno do grupo cruza a meia-noite → o cursor de "ontem" fica sem teste. Escalar um
  `Plantão N` no mês resolve.

### Pendências que bloqueiam a Fase 5

1. 103 marcações de intervalo existem em unidades com `permite_marca_intervalo = false`
   (artefatos da regressão de `20260804080000`). A reconciliação as **apagaria** — decisão
   explícita necessária, não pode ser efeito colateral.
2. As três regras de intervalo divergentes (armadilha 9) só convergem na Fase 8.
3. `fn_blocos_previstos_dia` e `fn_blocos_previstos_mes` são `SECURITY DEFINER` com `GRANT` para
   `authenticated` e **não validam acesso ao setor**. `fn_unidade_no_escopo(uuid)` já existe e é o
   helper certo. ⚠️ Pôr a checagem em `fn_blocos_previstos_dia` **propaga** para
   `fn_alocar_marcacoes_dia` → `fn_projecao_marcacoes_dia` → `fn_conferir_reconciliacao`: precisa
   de bypass para `service_role` (`auth.uid() IS NULL`). `fn_reconciliar_marcacoes_dia`, a única
   que escreve, já é `service_role` apenas.

✅ **Não é mais pendência:** a policy `WITH CHECK (true)` de `logs_tentativas_presenca` foi
fechada por `20260807130000`. O plano do REP ainda a listava como aberta.

❌ **Descartado (usuário, 08/08/2026):** marcar no relógio com matrícula + PIN. O relógio é
equipamento não supervisionado, e PIN ali reintroduz o "bater ponto pelo colega" — agora
respaldado por AFD assinado, o que torna o registro falso *mais* difícil de contestar. Some-se
que `servidores.pin_acesso` é bcrypt e não é recuperável para envio ao device.

## Conformidade da marcação de ponto (v1.22.0) — não regredir

A Portaria 671/2021 veda, em **qualquer** registrador — e o **REP-P é o registrador via
programa**, ou seja, o terminal `/presenca` se enquadra:

1. **restrições de horário à marcação**;
2. **marcação automática usando horários predeterminados ou contratuais**;
3. exigência de autorização prévia para sobrejornada;
4. qualquer dispositivo que permita alterar o dado registrado pelo empregado.

O sistema incorria na 1 e na 2. Três regras saíram disso e **nenhuma pode ser desfeita sem
decisão jurídica**:

| regra | onde vive | o que quebra se voltar atrás |
|---|---|---|
| Batida **nunca** é recusada por horário. Só matrícula/PIN inválidos recusam. | `fn_registrar_ponto` (`20260808100000`) | volta a vedação 1: o horário real se perde e o controle vira imprestável como prova (Súmula 338 do TST) |
| Entrada e saída do turno **nunca** são geradas pelo sistema | `src/utils/folha/preAssinalacao.ts`, aplicado nas 4 cópias da geração de folha | volta a vedação 2 |
| Validação manual grava o horário **informado**, não o derivado da jornada | `fn_registrar_presenca_informada` (`20260808110000`) | volta a vedação 2 pela porta do coordenador — era 24–29% das entradas/saídas |

**O que continua permitido:** pré-assinalação do intervalo (CLT Art. 74 §2º), e **somente** onde
a unidade não exige marcação de intervalo — ali o servidor não tem como registrar o repouso.
Horário **fixo**, sem o offset aleatório antigo, origem `pre_assinalado`.

O critério que separa um caso do outro: **o sistema só preenche onde o servidor não tem como
registrar.** Onde ele tem meio, preencher é fabricar.

⚠️ **Cor importa.** No terminal, âmbar = registrado fora do previsto (vai para revisão);
vermelho = nada foi registrado. Pintar de vermelho o que foi aceito ensina o servidor a não
insistir, produzindo na prática o efeito que a lei quer evitar.

**Validação em massa** (v1.22.1): `fn_atestar_jornada_bulk` envolve
`fn_confirmar_presenca_manual_bulk` e **pula os dias que têm batida pendente de revisão**,
devolvendo a lista ao chamador. É a regra de `fn_precedencia_origem` trazida para o fluxo do
coordenador: onde existe horário real disponível, ele ganha do declarado. A exclusão é por par
(escala, dia), não por servidor nem por período.

**Portal do servidor** (v1.23.0): a folha deixou de ser editável ali. A célula vazia (desde que
o fictício de entrada/saída foi removido) virava uma edição livre na folha oficial, sem revisão
e sem marcação — o mesmo problema da vedação 2, só que pela porta do servidor em vez da do
sistema. Agora ele **solicita** (`fn_solicitar_ajuste_ponto`), o pedido vira marcação
`ajuste_servidor` (precedência 4, a mais baixa) pendente de revisão, e só o coordenador grava em
`escala_diaria`. Bloqueio em duas camadas: `FolhaPontoEditor` desabilita os inputs quando
`isPortal`, e `salvarFolhaPontoServidor` recusa no servidor qualquer alteração de horário —
importa porque o portal autentica só por PIN e a action é chamável direto.

ℹ️ Uma nota anterior aqui chamava a validação em massa de "exposição residual à vedação 2".
**Era impreciso.** Conferido em produção em 08/08/2026: ela grava com origem
`ajuste_coordenador` e `sintetica = true`, e a folha a pinta como `manual` — o sistema não a
apresenta como batida. Coordenador declarando, com justificativa e rótulo próprio, é tratamento
autorizado pelo Art. 82, parágrafo único. A vedação 2 é o *sistema* marcar sozinho.

`fn_confirmar_presenca` e `fn_confirmar_presenca_manual` **não foram alteradas** por nada disso —
todo o comportamento novo entra por funções que as envolvem (armadilha 1).

## Acionamento de sobreaviso com destino (08/08/2026)

Plano em [`docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md`](docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md).
**As 5 migrations `202608081[5-9]0000` estão aplicadas em homologação e em produção**, conferidas
por sonda (backfill, índice único, FK composta, gatilho e CHECK). A única defesa não verificada
por fora é a policy — precisa de JWT de coordenador.

O sobreaviso era tratado como se pertencesse à unidade da escala. Quem está de sobreaviso atende
a rede inteira, e o `cheguei no local` conferia o GPS contra a **origem**. Medido nas 8 chegadas
com GPS que existem: todas conferidas contra o setor da TI, e em dois casos o destino real estava
a **3,3 km** e **4,0 km** dali — o servidor ia até a própria sala para o botão aceitar, e só então
se deslocava.

| o que mudou | onde |
|---|---|
| janela do Sobreaviso ganha **fonte única** no banco | `fn_janela_sobreaviso_dia` |
| chegada confere o **destino** (setor → unidade → origem) | `register_sobreaviso_arrival` |
| acionamento vira RPC; INSERT direto do cliente **deixa de existir** | `fn_acionar_sobreaviso` |
| painel do dashboard passa a ser **global** | `fn_painel_sobreaviso_dia` |
| quem pode acionar | `setores.sobreaviso_abrangencia` (`geral` × `unidade`) |

**Ver é global; acionar é por abrangência.** Default `'unidade'` — fecha por padrão. Só a TI da
SMS entra marcada como `geral` na migration; CAF e Transporte ficam para a tela.

⚠️ **`fn_blocos_previstos_dia` não serve para Sobreaviso** — exclui a categoria por construção
(armadilha 6), e os 5 códigos de sobreaviso têm `horario_inicio = NULL` de propósito. Por isso a
janela precisou de função própria. Não tente ancorar código de Sobreaviso no dicionário.

⚠️ **Efeito colateral a avisar antes de ligar:** `sobreaviso_tempo_chegada_minutos` (90 min) hoje
cronometra o deslocamento até a unidade de origem. Passando a cronometrar até o local do chamado,
chamados que hoje "chegam" no prazo podem estourar. É o comportamento correto, não é silencioso.

## Armadilhas conhecidas

### 1. `CREATE OR REPLACE` já apagou lógica crítica seis vezes

As funções de presença são recriadas inteiras a cada migration. **Seis regressões reais** já
aconteceram por omitir ou trocar um trecho ao recopiar — e **cinco delas saíram da mesma
migration, `20260804080000`**:

- 04/08/2026 — perda do alinhamento dinâmico de hora extra (documentado em `.agents/AGENTS.md`).
- `20260804080000` — perda do guard de intervalo, corrigido em `20260806000000`.

As quatro seguintes também são da `20260804080000`, e só apareceram em 07/08/2026, quando um
coordenador tentou validar uma presença:

| o que se perdeu | sintoma | correção |
|---|---|---|
| cast `p_categoria::public.escala_categoria` | `operator does not exist: escala_categoria = text` | `20260807060000` |
| colunas `justificativa_manual` / `confirmacao_manual`, que passaram a ser **escritas sem nunca terem sido criadas** | `column "justificativa_manual" does not exist` | `20260807070000` |
| `COALESCE(campo, sintético)` e as flags `presenca_*_manual` | validação manual **sobrescreveria batida real** e o intervalo manual apareceria como batida de terminal | `20260807080000` |
| o **segundo passo** de cada escopo de meio período | "1º Período" e "2º Período" pintavam 1 segmento em vez de 2 | `20260807100000` |

Nenhum dado foi corrompido só porque as duas primeiras abortavam a função **antes** de qualquer
`UPDATE` — a validação manual ficou inteiramente inoperante de 04/08 a 07/08/2026. Cuidado com a
ordem ao corrigir cadeias assim: destravar o erro visível sem corrigir o que estava atrás dele
teria liberado a escrita destrutiva.

**Uma função quebrada esconde as outras regressões dela.** As três últimas só ficaram visíveis
depois que as anteriores foram corrigidas, uma de cada vez. Ao consertar uma função que estava
inoperante, não presuma que o primeiro erro resolvido é o único: **compare o corpo inteiro com a
última versão que comprovadamente funcionava**, não só o trecho que estourou.

Escopos de validação manual e quantos passos cada um grava — a grade espelha isso:

| escopo | passos |
|---|---|
| Dia Completo | entrada + saída intervalo + retorno intervalo + saída |
| 1º Período | entrada + saída para o intervalo |
| 2º Período | retorno do intervalo + saída final |

Os passos de intervalo em todos eles são condicionados a `v_tem_intervalo`.

Nada disso quebra build ou deploy: **plpgsql resolve nomes de coluna e operadores só em tempo de
execução do statement**, e `CREATE OR REPLACE FUNCTION` aceita a função feliz da vida.
`npx tsc --noEmit` e `npm run build` não detectam nenhum desses cinco casos — mudança em função
de presença exige executar o caminho real.

**Antes de alterar `fn_confirmar_presenca*`:**

1. Descubra qual migration define a versão **vigente** — não é necessariamente a que o nome sugere.
   `grep -rln "FUNCTION public.fn_confirmar_presenca" supabase/migrations/ | sort | tail -1`
2. Gere a nova migration **copiando o arquivo vigente** e aplicando substituições pontuais por script,
   depois confira com `diff`. Não redigite o corpo à mão. Faça o script **abortar** se a contagem
   de ocorrências não for a esperada — foi isso que pegou uma indentação divergente em `20260807080000`.
3. Confirme que os guards existentes continuam presentes no resultado.
4. Confira que **toda coluna escrita existe de fato** — a função não avisa. Compare a lista de
   colunas do `UPDATE` com o que o banco realmente tem (ver armadilha 3).

### 2. As migrations não são o schema completo

Tabelas base (`escala_diaria`, `escala_mensal`, `jornadas`, `dicionario_turnos`, `servidores`,
`unidades`, `setores`) foram criadas **fora do versionamento** e só existem no banco.
`src/types/database.ts` também está incompleto — não contém `escala_diaria` nem `jornadas`.

**Não confie nos arquivos para saber a forma das tabelas. Consulte o banco.**

### 3. Dois bancos diferentes

| ambiente | URL | acesso |
|---|---|---|
| homologação | `.env.local` → `mtgfmxsbsyknotvwzdcr.supabase.co` | REST |
| **produção** | `.env.production` → `supabase-sisescala.coolify.vps.atb.app.br` | REST (porta 5432 bloqueada por firewall) |

Os schemas **divergem**. Sempre confirme em qual banco você está antes de concluir qualquer
coisa sobre os dados.

⚠️ Uma nota anterior aqui dizia que `justificativa_manual` / `confirmacao_manual` faltavam
*só em homologação*, sugerindo que produção as tinha. **Era falso.** Em 07/08/2026 se confirmou
que as colunas não existiam em nenhum dos dois — nenhuma migration jamais as criou, e a função
as escrevia desde `20260804080000` (criadas em `20260807070000`). Coluna ausente em homologação
não é evidência de divergência: **verifique nos dois**, e não presuma que produção é o superset.

Só há `DATABASE_URL` em produção, e a porta Postgres não é acessível de fora — na prática,
consultas são feitas via PostgREST com a service role key. **Peça autorização antes de tocar
em produção, mesmo para leitura.**

### 4. Horário previsto: cadeia de precedência de 4 níveis

⚠️ **Esta regra mudou em 08/08/2026.** Antes o horário era inferido só por regex sobre o nome da
jornada, e isso impediu três servidoras de bater ponto no mesmo dia. Ver
[`docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md`](docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md).

Não existe coluna `start_hour`. O horário é resolvido nesta ordem, e o primeiro não-nulo vence:

| nível | fonte | quando |
|---|---|---|
| 1 | `escala_diaria.hora_inicio_prevista` | o coordenador informou ao escalar. **Não vale para `Regular`** (constraint `chk_hora_prevista_nao_regular`) |
| 2 | `dicionario_turnos.horario_inicio` | o código determina a hora. **Só quando NÃO há turno `Regular` no dia** |
| 3 | regex sobre `jornadas.nome` | categoria `Regular` |
| 4 | cascata legada (`LIKE 'M%'`, `slots[1]`, alinhamento ao Regular) | último recurso, **nunca removida** |

```sql
substring(j.nome from '^([0-9]+)')                    -- "08H ÀS 12H" → 8
substring(j.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')   -- "08H ÀS 12H" → 12
```

**Renomear uma jornada ainda quebra o cálculo de presença** para `Regular` — o nível 3 continua
sendo regex sobre o nome.

**Por que o nível 2 só vale sem `Regular` no dia:** havendo turno Regular, o plantão é sequência
do expediente e o alinhamento da cascata está correto. Forçar a âncora ali sobreporia o plantão
ao Regular — medido em 49 dias reais de produção. **Não remover essa condição.**

**27 dos 64 códigos estão ancorados.** As famílias: `M T N MT` · `M?N` começa 19:00 (a noite
emenda na manhã seguinte) · `T?N` = `19h − (duração − 12)`, a tarde vem antes · `MT?` e `MTN`
começam 07:00 · intermediário (`I M4I IT4`) = 11:00–15:00. Os outros 21 são **Classe B** de
propósito: o código dá duração e período, não a hora — usam o nível 1. Só `MT4N` ficou sem
definição.

**Não ancore um código de Sobreaviso** — as migrations abortam se tentar (armadilha 6).

#### O frontend duplica isso, e a duplicação é parcialmente resolvida

- `getShiftForecastTime` **lê do banco** via `fn_blocos_previstos_mes` — um `LATERAL` sobre
  `fn_blocos_previstos_dia`, a mesma que o terminal usa. Por construção não diverge.
- `getShiftStartHour` / `getShiftEndHour` (`ScaleGrid.tsx`) **ainda existem** e servem o motor de
  compliance, o PDF e a sugestão de encadeamento. **Elas espelham as 27 âncoras à mão.** Ao
  ancorar um código novo, atualize as duas — as famílias `M?N`, `T?N` e intermediário têm testes
  de prefixo que precisam vir **antes** dos genéricos, senão `T2N` cai em 13:00 contra a âncora
  de 17:00.

#### Ao alterar as funções de presença

`scratchpad/gen_ancora.js` e `gen_hora_dia.js` fazem a cópia mecânica das **três** funções de uma
vez (`fn_confirmar_presenca`, `fn_confirmar_presenca_manual`, `fn_blocos_previstos_dia`),
conferem os invariantes antes e depois e **abortam** em qualquer divergência. Substituem o
`gen_blocos.js` que se perdeu. Use-os como modelo — não redigite corpo de função.

### 5. Horário sintético vs. batida real

Timestamps redondos (`:00:00`) são gerados por validação manual. Batidas reais de terminal têm
segundos e microssegundos. Ao auditar dados de ponto, **essa distinção decide se um registro pode
ser movido ou precisa ser refeito** — mover um horário sintético para outro campo fabrica um
registro de ponto falso.

⚠️ **A heurística não vale para o relógio de ponto.** O AFD registra com precisão de **minuto**
(`2026-08-07T22:20:00-0300`), então toda batida de REP tem segundos zerados sem ser sintética.
Por isso `fn_ingerir_afd` passa `sintetica = false` explicitamente para origem `rep`, e
`marcacoes_ponto.sintetica` é campo gravado, não derivado na leitura. Nunca reintroduzir a
inferência por segundos em cima de marcação de relógio.

### 6. Fusão de blocos: Sobreaviso nunca funde

`fn_confirmar_presenca` agrupa os turnos do dia em **blocos contínuos**: se um turno começa
antes ou no instante em que o anterior termina (`v_s2_inicio <= v_s1_fim`), viram um bloco só,
e a janela de **saída** passa a ser o fim do último turno.

Isso é **correto e desejado** para `Regular` + `Extra` + `Plantão` — ex.: 08h–18h + 2h extra +
Plantão N 12h formam um bloco único, com saída esperada no fim do plantão.

**Sobreaviso não entra nessa conta.** Não é trabalho presencial, não marca presença e tem ciclo
próprio em `logs_sobreaviso`. Agrava o fato de que o `start_hour` do Sobreaviso é alinhado ao fim
do turno Regular (o 3º elemento do `COALESCE` de `start_hour` **não filtra por categoria**), então
um Sobreaviso N12 encosta exatamente no fim da jornada e fundia com ela.

Sintoma quando quebra: servidor não consegue bater a saída, e `logs_tentativas_presenca` mostra
`escala_prevista_fim` com o horário do sobreaviso em vez do fim do turno.

**Sobreaviso não marca presença, ponto.** Ciclo próprio em `logs_sobreaviso`: acionamento →
aceite (magic link por WhatsApp/e-mail/SMS) → chegada (GPS ou validação manual). Nada disso
entra na folha de ponto, que lê só `Regular` e `Extra`.

⚠️ **`logs_sobreaviso` não é uma tabela de acionamentos.** Uma nota anterior aqui dizia
"522 acionamentos de produção, 514 Manual e 8 GPS". **É enganoso** — medido em 08/08/2026:

| linhas | o que é |
|---|---|
| 325 | artefato de validação manual de presença |
| 183 | artefato do terminal (`O próprio usuário confirmou…`) |
| 1 | artefato de validação manual na grade |
| **13** | **acionamento real — um coordenador digitou um motivo** |

`fn_confirmar_presenca` e `fn_confirmar_presenca_manual` também escrevem aqui, e os artefatos
entram com status `Chegou`. Dos 13 reais, **9 usaram o link mágico e 8 registraram chegada com
GPS** — o fluxo é usado; o número inflado é que escondia isso. **Ao contar acionamento, filtre
os artefatos** (`acionado_por IS NOT NULL` ou motivo que não case com os prefixos acima). Contar
tudo já produziu um relatório afirmando o oposto da realidade.

Três camadas de defesa, todas devem ser preservadas:

| camada | onde | migration |
|---|---|---|
| guards `<> 'Sobreaviso'` nas 8 fusões de bloco | `fn_confirmar_presenca` | `20260807000000` |
| `Sobreaviso` fora da lista de categorias dos blocos + função manual não escreve em `escala_diaria` | ambas as funções | `20260807020000` |
| `CHECK chk_sobreaviso_sem_presenca` | tabela `escala_diaria` | `20260807030000` |

A constraint é a única que sobrevive a um `CREATE OR REPLACE` descuidado — é ela que torna a
regra realmente definitiva.

⚠️ As checagens de **acesso** do coordenador (as que não têm `ORDER BY start_hour`) continuam
aceitando `Sobreaviso` de propósito: sem isso, quem tem só sobreaviso no dia perderia acesso
ao terminal.

### 7. Batidas recusadas ficam registradas

`logs_tentativas_presenca` guarda toda tentativa negada, com `data_hora_tentativa`,
`mensagem_erro` e `escala_prevista_inicio`/`fim`. É a **fonte de verdade** para recuperar
horários reais quando uma batida legítima foi recusada por bug — muito melhor que presumir
horário a partir da jornada. Ver `20260807010000` como exemplo, e `fn_reconciliar_presencas_negadas`.

⚠️ **A maioria das linhas não prova que alguém estava presente.** Auditoria de 07/08/2026
(911 tentativas, 361 em agosto):

| tentativas | o que é | serve como horário de ponto? |
|---|---|---|
| 378 | `Matrícula ou PIN inválidos` | **não** — identidade não confirmada, pode ser outra pessoa |
| 75 | `servidor_id` nulo | **não** — idem |
| 90 | `Nenhum plantão` / `Sem escala` | **não** — não havia escala no dia |
| 175 | janela de presença / erro interno | **sim** — pessoa identificada, recusada por bug |

Gravar um horário de "PIN inválido" na folha registra o ponto a partir de um erro de digitação.
O filtro canônico está em `fn_batidas_reais_recusadas` (`20260807090000`): exige `servidor_id`
preenchido **e** mensagem de janela/erro interno.

Também não há campo indicando **qual passo** a tentativa era. O casamento é por proximidade ao
horário previsto, guloso e sem reuso. Considerar só entrada e saída erra: muitas tentativas caem
por volta das 12h em jornadas 08:00–18:00 (almoço) e ficavam a 250–295 min do passo escolhido.
Incluindo os 4 passos, a distância cai para p50 = 51 min. Tolerância adotada: **90 min**
(aproveita 89%; o resto cai no horário previsto, que é o comportamento seguro).

### 8. PostgREST corta em 1000 linhas

Consultas via REST retornam no máximo 1000 registros, **silenciosamente** — `limit=2000` não
adianta. `escala_diaria` tem ~3.500 linhas só em 08/2026. Sem paginação por header `Range`,
auditorias dão resultado errado e parecem corretas. Já causou dois diagnósticos falsos.

```js
for (let from = 0; ; from += 1000) {
  const r = await fetch(url, { headers: { ...H, Range: `${from}-${from + 999}` } })
  const page = await r.json(); out.push(...page)
  if (page.length < 1000) break
}
```

### 9. Regra de intervalo intrajornada (CLT Art. 71)

Intervalo só para jornadas **acima de 6h**. Fonte única:

```sql
public.fn_jornada_tem_intervalo(p_duracao_minutos, p_intervalo_minutos)
  -- duração > 360 min E intervalo_minutos > 0
```

**Modo do intervalo** — três níveis, do mais geral ao mais específico:

1. `unidades.tipo_intervalo` = `flexivel` | `rigido`
2. `servidores.intervalo_inicio/fim_personalizado` — exceção de **horário** dentro do modo rígido
3. `servidores.intervalo_flexivel` (bool) — libera horário livre **mesmo em unidade rígida**

Com `intervalo_flexivel = true`, os campos personalizados deixam de ser horário obrigatório e
passam a definir só a **duração prevista**. A saída vira dinâmica:

```
saída_esperada = fim previsto + (intervalo real − intervalo previsto)
```

Excedente adia, déficit antecipa (mantém a carga líquida). Sem nenhuma marcação de intervalo,
a saída fica no horário previsto. Implementado em `20260807050000` via
`fn_ajuste_intervalo_flexivel`; os passos 2 e 3 do terminal ganham ramos próprios para o modo
flexível. **Preserve-os ao recriar a função.**

Vale para **todas** as categorias, inclusive Plantão. No cadastro atual, toda jornada ≤ 6h tem
`intervalo_minutos = 0`. A duração vem de `horas_totais` (Regular) ou `horas_computadas` do turno
(Plantão/Extra). `ScaleGrid.tsx` espelha essa regra para escolher entre 2 e 4 segmentos — se alterar
uma ponta, altere a outra.

### 10. O identificador do AFD é CPF com **um** zero à esquerda

O registro tipo 3 do AFD (a marcação) carrega apenas `NSR + data/hora + identificador(12) + CRC`.
**A matrícula não aparece em nenhuma marcação** — só no tipo 5 (cadastro) e no `load_users.fcgi`.
Por isso `rep_vinculos_servidor` é a única ponte, e precisa ser populada **antes** de qualquer
`remove_users.fcgi`: apagado o usuário do relógio, os NSRs antigos ficam órfãos para sempre.

O identificador é o CPF preenchido a 12 posições. A inversa é `right(ident, 11)`, **nunca**
`ltrim(ident, '0')`:

```
053638930459 → ltrim → 53638930459  (11)  CPF 53638930459  ✅
008943857128 → ltrim →  8943857128  (10)  CPF 08943857128  ❌ perdeu um dígito
```

**37% dos servidores com CPF preenchido começam com zero** (47 de 127, medido em 08/08/2026),
então o erro atinge um terço da base de forma aparentemente aleatória — e o sintoma é órfã
fantasma no módulo de pendências, que leva alguém a vincular a pessoa errada na mão. Corrigido
em `20260808090000`.

Agrava: quem usa relógio tende a ter `cpf` nulo no SisEscala, e `pis_pasep` está vazio em 100%
dos registros. Auditor fiscal casa por PIS/NIS — é projeto de qualidade de dados da Fase 9.

## Convenções

- **Idioma:** identificadores de domínio, comentários e mensagens de usuário em português.
  Migrations SQL sem acentos nos comentários.
- **Migrations:** `YYYYMMDDHHMMSS_descricao_em_ingles.sql`. Arquivos usam **CRLF** — scripts que
  fazem substituição de texto precisam tratar isso.
- **Nunca** rode migration direto em produção sem validar em homologação antes.
- Timezone padrão: `configuracoes_globais.timezone`, fallback `America/Sao_Paulo`.

## Verificação

```bash
npx tsc --noEmit     # type-check
npm run build        # build de produção
npm run lint
```

Não há testes automatizados. Mudanças em lógica de presença exigem verificação manual na grade
e no terminal, além da consulta de conferência incluída em cada migration de dados.
