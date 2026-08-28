# O teto de 300h é por escala, e a pessoa tem várias

**28/08/2026.** Motivado por um caso real que o usuário achou na grade: **JEANE CONCEICAO SILVA**,
setembro/2026, HMI — `SHL \ ACOLHIMENTO` com **289h** de previsão e `SHL \ LAVANDERIA` com **120h**.
São **409h** para a mesma pessoa no mesmo mês, e as duas telas mostram um número dentro do teto.

O sistema tem, desde `20260811140000`, um teto de **300h por servidor por mês** em
`configuracoes_globais.max_horas_escala_servidor`, com Autorização Extraordinária de administrador
para ultrapassá-lo. O teto é **da pessoa**; a conta que o defende é **da grade**.

---

## O que está quebrado (lido no código)

| # | fato | onde |
|---|---|---|
| 1 | A conta soma só `calculateTotals(servidorId)`, que lê o `gridData` **daquela** grade. Escala em outro setor ou outra unidade é invisível | `ScaleGrid.tsx:1728-1786` |
| 2 | `handleCellChange` tem **um único chamador** em todo o repositório: o `<select>` da célula (`ScaleGrid.tsx:4491`). **Aplicar Template, Gerador Inteligente e `persistirMesesGerados` escrevem direto no `gridData`** e nunca consultam o teto | `grep -n handleCellChange` devolve 2 linhas |
| 3 | **Não existe nada no banco.** Nenhum trigger, nenhuma função. `max_horas_escala_servidor` aparece em **uma** migration, a que cria a chave | `grep -rln max_horas_escala_servidor supabase/migrations/` |
| 4 | `excecoes_escala_servidor` tem chave `(servidor_id, unidade_id, mes, ano)` — **não existe onde morar** uma autorização que valha para a pessoa no mês | `20260811140000` |
| 5 | O modal de autorização compara contra `horasAtuais`, que é `totals.totalPlanejado` — o mesmo número parcial | `AutorizacaoExcecaoModal.tsx` |

É a **armadilha 14 e a 23 num terceiro eixo**: lá o furo do Aplicar Template era afastamento (fechado
em `20260820120000`) e sobreposição entre setores (fechado em `20260826220000`); aqui é carga horária,
e sem rede de segurança no banco.

⚠️ **O motor de compliance tem o mesmo ponto cego.** `runComplianceCheck` (`complianceEngine.ts`)
recebe só o `gridData` local, então **interjornada e DSR também não enxergam o outro setor** — a
JEANE pode ter `MT` num setor e `N` no outro em dias vizinhos sem nenhum dos dois alertas disparar.
Fora do escopo desta correção; registrado para não se perder.

---

## Medido em produção (28/08/2026, leitura autorizada)

1.599 escalas mensais · 24.610 linhas de `escala_diaria` · competências **06/2026 a 10/2026**.

**Servidores em 2+ escalas na mesma competência:**

| competência | pares (servidor, competência) |
|---|---|
| 06/2026 | 3 |
| 07/2026 | 2 |
| 08/2026 | 2 |
| **09/2026** | **49** |
| 10/2026 | 0 |

⚠️ **O caso não é antigo — ele explodiu agora, no planejamento de setembro.** Dos 49, **11 têm horas
lançadas em mais de uma escala**; os outros ainda estão com a segunda escala vazia.

**Quem estoura o teto de 300h somando as escalas — e só somando** (11h35, primeira medição):

| servidor | total | composição (todas HMI, todas em Rascunho) |
|---|---|---|
| JEANE CONCEICAO SILVA (15867) | **409h** | `SHL \ ACOLHIMENTO` 289h + `SHL \ LAVANDERIA` 120h |
| EDIVONETE NOGUEIRA NASCIMENTO (29301) | **314h** | `SHL \ CENTRO OBSTÉTRICO` 194h + `SHL \ LAVANDERIA` 120h |
| ERIKA SOUZA LIMA (53609) | **302h** | `UCI \ ENFERMEIROS` 180h + `CLASSIFICAÇÃO DE RISCO` 122h |

Os 120h e 289h da JEANE são **exatamente** os números das duas telas — o que confirma que a fórmula
de agregação abaixo reproduz `calculateTotals`.

🚨 **A lista cresceu enquanto este plano era implementado.** Remedido no fim da tarde do mesmo dia,
sem que ninguém tenha sido avisado de nada: **NANCI IRAIDES OLIVEIRA MAGALHAES (8736) 326h**
(`SND \ COPEIRO / COZINHEIRO / ASG` 218h + `SHL \ ROUPARIA` 108h) e **MARIA KEDMA DE SOUSA (8273)
314h** (`SHL \ ACOLHIMENTO` 290h + `SHL \ BLOCO B` 24h). Os servidores em 2+ escalas com carga em
09/2026 passaram de 14 para 18 no mesmo intervalo.

É a medida do risco: o planejamento de setembro está acontecendo agora, e cada hora que passa
acrescenta casos. **A lista da etapa 4 abaixo tem que ser remedida imediatamente antes de aplicar
em produção** — não use os nomes deste documento.

**Escalas individuais acima de 300h:** 2, ambas 07/2026, **Fechadas**, LACEM (WILKENS 313h, AGNA 302h)
— anteriores à criação da regra em 11/08/2026. Nada a fazer com elas.

**`excecoes_escala_servidor`: 0 linhas.** Em produção inteira, **ninguém nunca autorizou uma exceção**
— o teto nunca foi exercido uma vez sequer. Isso torna a mudança de chave da tabela gratuita.

**Configuração real:** `max_horas_escala_servidor` = `300`, `max_sobreavisos_escala_servidor` = **`20`**
(não 10 — foi alterado na tela desde a migration).

**Sobreaviso consolidado:** 1 caso acima de 20 un (FERNANDO, 08/2026, 23 un) e ele está **numa escala
só**. **Zero** servidores com sobreaviso em 2+ escalas. O eixo do sobreaviso é preventivo.

✅ **A base está praticamente limpa** — 3 casos, todos em Rascunho, todos na mesma unidade. Dá para
ligar a trava, desde que os 3 sejam resolvidos ou autorizados **antes** (armadilha 23: limpar vem
ANTES de ligar a trava).

Portões de medição: `scratchpad/an_limite_consolidado.mjs`, `an_limite_horas.mjs`, `an_limite_sob.mjs`.

---

## Decisões tomadas (usuário, 28/08/2026)

| decisão | escolha |
|---|---|
| escopo do teto | **da pessoa no mês**, somando todas as escalas — unidade e setor não importam |
| escopo da autorização | **uma por (servidor, mês, ano)**. `unidade_id` vira registro de *quem autorizou*, não parte da chave |
| comportamento ao estourar | **o mesmo de hoje, agora consolidado**: admin vê o aviso e pode abrir a Autorização Extraordinária; quem não é admin é recusado |

⚠️ **Por que a autorização não pode continuar por unidade:** com duas escalas em unidades diferentes,
dois administradores concederiam +100h cada e o teto efetivo viraria 500h — sem que ninguém tenha
decidido isso. Somar as autorizações apaga o teto; pegar a maior torna o teto dependente de qual
unidade agiu primeiro. A autorização é uma decisão sobre **o mês daquela pessoa**, e precisa ser uma só.

---

## Plano

### Fase 1 — banco: a conta consolidada ganha fonte única

Migration `20260828120000_consolidated_monthly_hour_limit.sql`.

**`fn_carga_mensal_servidor(p_servidor_ids uuid[], p_mes int, p_ano int)`**
→ `TABLE(servidor_id, escala_mensal_id, unidade_id, setor_id, unidade_nome, setor_caminho, status, horas numeric, sobreavisos int)`

Uma linha por escala do servidor na competência — no máximo ~4 por pessoa, longe do corte de 1000
do PostgREST (armadilha 8).

A fórmula espelha `calculateTotals`:

| categoria | horas |
|---|---|
| `Regular` | `LEAST(horas_computadas, GREATEST(0, jornadas.horas_totais − intervalo_minutos/60))` — o teto líquido da jornada |
| `Extra` · `Plantão` | `horas_computadas` |
| `Sobreaviso` | **não soma hora**; conta unidades, em coluna própria |

⚠️ **A decomposição de plantão (`decomporPlantao`, armadilha 16) NÃO precisa ser replicada em SQL, e
tentar isso é o erro.** O total de `calculateTotals` é `pl12*12 + pl6*6 + pl4*4 + avulso`, que é
**exatamente `SUM(horas_computadas)`** — o próprio comentário do código diz isso. As unidades PL
existem para as **colunas** de pagamento, nunca para o total. Quem "consertar" essa função somando por
faixa de duração reintroduz o bug de 21/08/2026 (44 dos 53 códigos contando errado) dentro da trava.

**`fn_teto_carga_servidor(p_servidor_ids uuid[], p_mes int, p_ano int)`**
→ `TABLE(servidor_id, teto_horas numeric, teto_sobreavisos int, limite_global_horas, limite_global_sobreavisos, horas_autorizadas, sobreavisos_autorizados, motivo, autorizado_por, autorizado_em)`

Recebe **lista**, como a de carga: a grade tem dezenas de linhas, e uma chamada por servidor seria
uma requisição por linha a cada carregamento.

Lê `configuracoes_globais` — que é **chave/valor com `valor` jsonb**, então
`SELECT (valor#>>'{}')::text FROM configuracoes_globais WHERE chave = ...`, nunca uma coluna
homônima — e soma a exceção, se houver. **Fonte única do teto efetivo**: nem a tela nem o modal
recalculam.

⚠️ **As duas são `SECURITY DEFINER` de propósito.** A RLS de `escala_mensal` impediria o coordenador
da LAVANDERIA de enxergar a escala do ACOLHIMENTO — e é justamente isso que ele precisa saber. A
função devolve **unidade, setor, status e o agregado**, nunca dia a dia nem código de turno: o
mínimo para a decisão, e nada da escala alheia além disso. Registrar essa fronteira no comentário.

⚠️ **`REVOKE ... FROM PUBLIC, anon` + `GRANT TO authenticated` na mesma migration** (armadilha 24 —
`GRANT ... TO authenticated` sozinho nunca restringiu nada), com a migration **conferindo o próprio
resultado** por `has_function_privilege` nos dois sentidos e abortando na divergência.

**Reconfiguração de `excecoes_escala_servidor`:**

- `DROP CONSTRAINT uq_excecao_servidor_unidade_mes_ano` → `UNIQUE (servidor_id, mes, ano)`.
- `COMMENT ON COLUMN unidade_id`: "unidade a partir de onde a autorização foi dada; auditoria, não
  parte da chave — o teto é da pessoa no mês".
- **A migration aborta se encontrar mais de uma exceção por (servidor, mês, ano)** antes de criar a
  constraint. Produção tem 0 linhas, mas homologação pode não ter — e a migration precisa dizer isso
  em vez de estourar com a mensagem crua do índice.

**Sem trigger nesta rodada, e isso é decisão, não esquecimento.** O comportamento escolhido é aviso +
autorização do administrador; um trigger duro exigiria a exceção gravada **antes** do upsert em lote
do "Salvar Previsão", invertendo a ordem do fluxo (o admin só descobre o excesso *ao salvar*). Se um
dia virar rede de segurança, a forma é a da `20260826220000`: recusar só quando a linha **nova** piora
o excesso, com guard `IS DISTINCT FROM` para que `UPDATE` de presença nunca atravesse a checagem — e
só depois de limpar os casos existentes.

### Fase 2 — frontend: fonte única e os quatro caminhos de escrita

**`src/utils/limiteCargaMensal.ts`** (novo, módulo puro, espelha as funções acima):

```ts
export interface CargaEscala {
  escala_mensal_id: string
  unidade_nome: string
  setor_caminho: string
  status: string
  horas: number
  sobreavisos: number
}

export function avaliarCarga(args: {
  horasLocais: number                  // calculateTotals().totalPlanejado, a grade viva
  sobreavisosLocais: number            // calculateTotals().p_soQtd
  cargas: CargaEscala[]                // fn_carga_mensal_servidor
  escalaMensalIdAtual: string | null   // excluída: a grade viva é a verdade dela
  tetoHoras: number
  tetoSobreavisos: number
}): {
  totalHoras: number
  totalSobreavisos: number
  horasOutras: number
  excedeHoras: boolean
  excedeSobreavisos: boolean
  outras: CargaEscala[]
}

export function descreverCarga(r: ReturnType<typeof avaliarCarga>): string
```

⚠️ **A escala DESTA grade é excluída das cargas vindas do banco e substituída pelo total local** —
pelo mesmo motivo de `encontrarConflitoExterno` receber `escalaMensalId`: o banco tem o que foi salvo,
a grade tem o que está sendo lançado. Somar os dois conta o mesmo turno duas vezes.

Portão: `scratchpad/sim_limite_carga.js`, transpilando antes com
`npx tsc src/utils/limiteCargaMensal.ts --outDir scratchpad/_sim --module commonjs --target es2020`
(mesmo padrão de `sim_caminho_setor.js`). Casos: a escala atual não soma duas vezes; sem carga externa
o resultado é idêntico ao de hoje; exceção eleva o teto; Sobreaviso não entra nas horas.

**`ScaleGrid.tsx`:**

| ponto | mudança |
|---|---|
| carga externa | buscar `fn_carga_mensal_servidor` no mount, ao lado de `fetchOccupancy`; recarregar depois de salvar e ao adicionar servidor |
| teto | buscar `fn_teto_carga_servidor` no lugar de montar `globalMaxHoras + excecao` à mão |
| coluna **TOTAL H/MÊS** | ganha a linha **OUTRAS** (só aparece quando > 0) e o **CONSOLIDADO**, com tooltip listando `UNIDADE / SETOR — Nh` por escala. A célula fica vermelha quando o consolidado passa do teto |
| `handleCellChange` | a simulação passa a somar as cargas externas |
| **Aplicar Template** | avalia antes de escrever; recusa/avisa relatando **o que mudou**, nunca o que foi calculado (armadilha 22) |
| **Gerador Inteligente** | idem, incluindo `persistirMesesGerados` para os meses extras |
| **`handleSave`** | **relê `fn_carga_mensal_servidor` do banco** antes do upsert, exatamente como já faz com `fn_get_monthly_occupancy` — aba desatualizada é o caso que a checagem local não cobre |
| `handleAddServer` / `handleAddAll` / Servidor Externo | avisar **no momento de adicionar**: "JEANE já tem 289h em HMI · `SHL \ ACOLHIMENTO` neste mês (teto 300h)". É onde o aviso custa menos — antes de lançar as 120h |
| `persistirMesesGerados` | os meses extras vão **direto para o banco**, sem grade que os segure — se o teto não for conferido ali, não é conferido em lugar nenhum para eles. Confere contra a competência **de destino**, com `escalaMensalIdAtual: null` (nada é excluído: as células novas são o "local", tudo que já está gravado é o externo) |
| escudo vermelho na linha do servidor | é por onde o administrador abre a Autorização Extraordinária depois de o "Salvar Previsão" recusar o lote. Sem ele a recusa não teria saída |

⚠️ **Duas decisões de comportamento que valem registrar:**

- **Aplicar Template é tudo ou nada**, e o template **não é aplicado** quando estoura — a alternativa
  (preencher até bater no teto) entregaria meio mês escalado com o corte num dia arbitrário.
- **O Gerador Inteligente também é tudo ou nada por servidor**, e só recusa quando o resultado
  **piora**: quem já estava acima do teto não fica impedido de receber uma sugestão que não
  acrescenta hora nenhuma. Os servidores recusados aparecem nomeados no resumo, com onde estão as
  outras horas — o teto é o único motivo de recusa que depende de **outra escala**, e sem dizer isso
  o coordenador olha a própria grade, vê espaço sobrando e não entende nada (armadilha 22).

⚠️ **A barreira do `handleSave` RECUSA em caso de falha de rede**, ao contrário da de sobreposição
entre setores. Lá o trigger do banco é a defesa real e o `catch` pode deixar passar; aqui **não há
trigger**, então esta é a última defesa e um erro de conexão não pode virar "salvou mesmo
estourando" em silêncio.

O caminho do setor sai de `buildSectorPathMap`/`formatSectorPaths` (`src/utils/sectors.ts`) — "BLOCO A"
sozinho não identifica setor, e a mensagem precisa dizer **qual**.

**`AutorizacaoExcecaoModal`:**

- recebe o detalhamento por escala e mostra a **composição do mês** (grade atual + outras), não só
  um número — sem isso o administrador vê "409h" numa grade que mostra 120h e não tem como conferir
  nada, que é justamente a cegueira que a autorização está sendo chamada a resolver;
- a **margem sugerida** passa a cobrir o excesso do mês inteiro (era onde ela saía curta);
- `upsert` com `onConflict: 'servidor_id,mes,ano'`;
- o texto deixa de falar em limite "da unidade" — a autorização é do mês da pessoa.

⚠️ **`fetchExcecoesEscala` perdeu o filtro por unidade.** Com a autorização valendo para a pessoa no
mês, filtrar por unidade faria esta grade ignorar uma autorização concedida a partir do outro setor
e recusar um lançamento que já estava autorizado.

### Fase 3 — visibilidade fora da grade

A checagem dentro da grade resolve para quem está lançando, **e só ali**: a informação "esta pessoa
tem 409h somando dois setores" só aparece se alguém abrir justamente uma das duas grades. Quem
confere o mês teria que abrir 96 setores para achar 3 pessoas.

**`fn_carga_mensal_consolidada(p_mes, p_ano)`** (migration `20260828130000`) devolve uma linha por
servidor com o total, o teto, a situação e o `jsonb` das escalas. Alimenta
**`/relatorios/carga-consolidada`**.

| decisão | por quê |
|---|---|
| só lista quem está em **2+ escalas com carga** ou **acima do teto** | listar todo mundo seriam 500 linhas por competência para achar 3, e o corte silencioso de 1000 do PostgREST (armadilha 8) ficaria a uma competência de distância |
| **não tem filtro de unidade nem de setor** | a pergunta é "quanto esta PESSOA tem no mês", e a resposta cruza setores por definição — filtrar devolveria a conta parcial que o relatório existe para corrigir |
| escopo por **unidade**, resolvido uma vez cada | são ~1.600 escalas por competência contra algumas dezenas de unidades, e `fn_unidade_no_escopo` faz um `EXISTS` a cada chamada |
| guard de papel por **denylist** (barra só `servidor`/`comum`) | allowlist esquece papel novo — foi o que aconteceu com `rh` e `rh_unidade` em `fn_painel_sobreaviso_dia` |
| a tela **não reclassifica nada** | usa `fn_carga_mensal_servidor` e `fn_teto_carga_servidor`, as mesmas da grade |

---

## Ordem de execução e portões

1. `node scratchpad/an_limite_horas.mjs` — linha de base. Em 28/08/2026 saiu de 3 para **5** casos
   que só estouram somando em poucas horas, mais 2 escalas individuais de 07/2026 já Fechadas e
   anteriores à regra. **Rode de novo na hora de aplicar**; a lista está viva.
2. Migrations `20260828120000` e `20260828130000` em **homologação**, conferidas pelas consultas
   embutidas em cada uma.
3. Frontend — feito: `node scratchpad/sim_limite_carga.js` (45 casos), `npx tsc --noEmit` e
   `npm run build` passam. ⚠️ `npm run lint` não roda nesta máquina (ESLint não instalado
   localmente); quem valida é o CI.
4. **Resolver os casos de setembro que a etapa 1 listar** — reduzir a escala ou gravar a Autorização
   Extraordinária. Decisão do RH, não do código.
   ⚠️ **Antes de aplicar em produção**, porque com eles no lugar os setores envolvidos não
   conseguem mais salvar nada na competência (armadilha 23: limpar vem ANTES de ligar a trava).
5. Migrations em **produção**.
6. Rodar o script de medição de novo: nenhum caso acima do teto sem exceção.

## O que este plano NÃO faz

- **Não recalcula folha nem escala existente.** A correção é de conta e de aviso; nenhum horário,
  hora normal ou falta se move.
- **Não toca em `fn_confirmar_presenca`** nem em nada de ponto.
- **Não corrige o ponto cego de interjornada/DSR entre escalas** — mesmo defeito, eixo diferente,
  registrado acima.
- **Não estende a autorização para `rh`/`rh_unidade`.** Continua `admin`/`super_admin`, como hoje.
