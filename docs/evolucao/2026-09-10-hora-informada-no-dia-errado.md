# A hora informada não diz de que dia ela é — e o sistema chutava "hoje" (10/09/2026)

**Relato do usuário:** *"ainda estou com problema na escala dos agentes de portaria vigias (…) eu
deveria ver as marcações; quando clico na saída da hora extra não aparece a batida das 7h +1d como
deveria, só aparece a batida das 18h que foi quando ele entrou."*

USF Demósthenes Ayres Azevedo, setor PORTARIA, competência 09/2026.

---

## O que se mediu, e por onde

O sintoma relatado é de tela. A causa é de previsão, e ela aparece chamando
`fn_blocos_previstos_dia` para o servidor e o dia:

```
### 305 ANTONIO HUMBERTO TEIXEIRA LOPES — 2026-09-01
  bloco 1  Extra    01/09 06:00 -> 01/09 07:00     <-- 12h ANTES do turno que ela emenda
  bloco 2  Regular  01/09 18:00 -> 02/09 06:00
```

A hora extra de passagem de turno, informada como **06:00**, nasce às 06:00 do **próprio dia** — ou
seja, doze horas antes de o vigia sequer entrar. Ela deveria ser 06:00 → 07:00 do dia **seguinte**,
emendada no fim do turno noturno.

Daí saem, em cascata, três coisas — e só a primeira tinha sido relatada:

1. **A batida das 07:0x do dia seguinte some do modal.** A lista do modal é a união do dia civil da
   célula com a janela prevista do bloco (`src/utils/janelaBatidas.ts`). Com o bloco doze horas fora
   do lugar, a batida real cai em `fora` e não é listada. Sobra a das 18:00 — que é a *entrada*.
2. **A alocação automática nunca casa a batida com o passo do Extra**: ela fica 25h longe do slot.
   Sobra para o slot de saída do Regular, que ela ultrapassa em 1h. Por isso "Preencher pelas
   Batidas" também não resolvia: o cálculo já estava sendo feito sobre o previsto errado.
3. **A folha fica errada** — e este é o pior, não estava no relato, e é o que motiva a pressa.

## O estrago na folha

A folha consolida o dia por `min(entrada)` / `max(saída)` sobre Regular + Extra
(`src/utils/folha/origemMarcacao.ts`). Com o Extra gravado às 06:00 do dia civil, o `min` passa a
ser 06:00 — e o turno de doze horas desaparece do documento.

Folha de **ILMAR DA SILVA DE OLIVEIRA** (mat. 54457, USF ENFERMEIRA ZEZINHA), 08/2026, status
**Revisada**:

| dia | folha diz | o que houve |
|---|---|---|
| 4 | `17:44 → 07:01` | correto — naquele dia o Extra caiu no dia certo |
| 6 | `17:53 → 07:00` | correto |
| **10** | **`06:00 → 07:00`** | 17:4x → 07:00 do dia 11 |
| **12** | **`06:00 → 07:00`** | 17:5x → 07:00 do dia 13 |
| **14** | **`06:00 → 07:00`** | 18:00 → 07:00 do dia 15 |
| **18** | **`06:00 → 07:01`** | 17:4x → 07:01 do dia 19 |
| **20** | **`06:00 → 07:01`** | 17:3x → 07:01 do dia 21 |

**A folha de um vigia noturno registra uma hora trabalhada** nesses dias. O mesmo padrão em
AGACY ROCHA DA CRUZ (mat. 8171), na mesma unidade, no mesmo mês.

⚠️ **Os dias 4 e 6 são a prova de que não é o cálculo da folha que está errado.** Nesses dois o
Extra tinha sido gravado no dia certo, e a folha saiu certa com o mesmo código, no mesmo mês, para
a mesma pessoa. O que varia é onde a previsão põe a hora extra.

## Alcance medido

Sobre as 1.265 linhas de `escala_diaria` com `hora_inicio_prevista` preenchida:

| | linhas |
|---|---|
| **mudam de dia com a correção** | **145** — 11 servidores, 8 unidades, competências 08 e 09/2026 |
| dessas, código `1` (hora extra) | 132 |
| dessas, código `1N` (hora extra noturna) | 13 |
| já têm presença gravada | 26 (todas 08/2026, folhas `Revisada`) |
| dia cujo Regular não cruza a meia-noite | 844 — inalteradas |
| sem Regular no dia | 274 — inalteradas |
| **ficam inalteradas de propósito** | **1** (ver abaixo) |

As unidades: USF Hiroshi Matsuda, USF Demósthenes, USF Pedro Cavalcante, LACEM, USF Laranjeiras,
USF Enfermeira Zezinha e outras duas. Não é um caso de uma portaria — é o desenho da escala de
vigia, que se repete na rede inteira.

## A causa

`escala_diaria.hora_inicio_prevista` é o **nível 1** da cadeia de precedência de horário
(`docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md`): a hora que o coordenador informou,
a que vence todas as outras. Só que ela é um `time` — **não carrega dia**. E o nível 1 fazia:

```sql
CASE WHEN ed.categoria <> 'Regular'
     THEN extract(hour from ed.hora_inicio_prevista)::integer END
```

O resultado vira `start_hour * 60`: sempre o dia civil da célula.

🚨 **A ironia é que, sem a hora informada, o sistema já acertava.** O último ramo da cascata legada
resolve o início de um turno não ancorado pelo **fim da jornada Regular do dia, somando 24 quando
ela cruza a meia-noite** — exatamente `06:00 do dia seguinte`. Era **informar a hora que quebrava**.
E informar a hora é obrigatório: sem ela a célula fica `?h` e a coluna vai nula ao banco
(armadilha 51, escrita quando o Revezamento de Vigias foi construído).

Ou seja: a ferramenta de Revezamento de Vigias fazia a coisa certa segundo a regra escrita, e a
regra escrita é que tinha um buraco.

## A correção

Fonte única em duas funções, `20260910110000`:

| função | papel |
|---|---|
| `fn_hora_prevista_dia_seguinte(hora, duração, reg_ini, reg_fim)` | **pura** — decide, dados os números |
| `fn_hora_prevista_no_eixo_do_dia(escala_mensal, dia, hora, duração)` | busca o Regular do dia e devolve a hora no eixo (pode passar de 24, como o resto da cascata já faz) |

A regra dispara quando, e somente quando:

- **(a)** o Regular do dia **cruza a meia-noite**;
- **(b)** a hora informada é **exatamente** a hora em que essa jornada termina;
- **(c)** no dia civil o turno terminaria **antes** do início da jornada, deixando um vão.

⚠️ **(c) é o que separa o caso resolvível do ambíguo, e é o coração do desenho.** Uma hora extra de
1h às 06:00 numa jornada `18H ÀS 06H` termina às 07:00 e fica onze horas solta antes do turno: no
dia civil ela não emenda em nada, no dia seguinte ela emenda perfeitamente — não há duas leituras.
Já um **Plantão MT de 12h às 07:00 numa jornada `19H ÀS 07H` emenda dos dois lados**
(07:00–19:00 encosta no início; 07:00+1 encosta no fim), e aí **não há como afirmar** o que o
coordenador quis. Essa linha — a única da base — fica **inalterada**, com o comportamento de hoje e
com o nível 2-A, que já põe o plantão diurno *antes* da jornada noturna de propósito
(`20260809000000`).

⚠️ **Não afrouxar (b) para "hora ≤ fim da jornada".** Passaria a valer para qualquer hora da
madrugada, inclusive as que caem *dentro* do turno noturno, onde as duas leituras são possíveis e a
escolha viraria chute. Se um dia aparecer caso real fora desta forma, o caminho é dar ao coordenador
como dizer o dia — nunca alargar a adivinhação.

ℹ️ **O guard (a) é redundante hoje e fica assim mesmo.** Numa jornada diurna a hora informada só
passa por (b) se for igual ao fim, e aí (c) já recusa sozinho. Ele fica porque enuncia a condição
que dá nome à regra: se (b) ou (c) mudarem, é ele que impede a mudança de alcançar as 844 linhas de
jornada diurna. Por ser inalcançável, **nenhuma tabela-verdade o pega** — quem o protege é a
checagem estrutural do portão.

### Onde a correção entra

Cópia mecânica (armadilha 1) nos **4 cursores** que leem o nível 1, gerada por
`scratchpad/gen_hora_eixo_do_dia.js`:

| função | fonte vigente | cursores |
|---|---|---|
| `fn_confirmar_presenca` | `20260909100000` | 2 (ontem e hoje) |
| `fn_confirmar_presenca_manual` | `20260903100000` | 1 |
| `fn_blocos_previstos_dia` | `20260908140000` | 1 |

⚠️ **O gerador pegou duas divergências que uma edição à mão teria produzido em silêncio:**

1. **O recuo não é o mesmo nas três.** `fn_confirmar_presenca` e `fn_blocos_previstos_dia` escrevem
   o cursor com 16 espaços; `fn_confirmar_presenca_manual`, com 12. Um padrão de busca com recuo
   fixo vira **no-op silencioso** naquela função — o mesmo modo de falha do EOL errado
   (armadilhas 48 e 59). O gerador **deriva** o recuo da própria fonte e confere que é único.
2. **`fn_confirmar_presenca_manual` não funde blocos.** Exigir dela as marcas `dobra_diurna` e
   `IS NOT DISTINCT FROM v_s2_unidade` reprovava a migration pelo motivo errado. Os invariantes
   passaram a ser por função.

### Na grade

A célula passa a mostrar **`06:00+1D`** quando a hora informada resolve para o dia seguinte, e o
tooltip explica. O rótulo vem do **bloco previsto do banco** (`fn_blocos_previstos_mes`), não é
recalculado na tela — e usa o mesmo `rotuloDiaRelativo` das batidas do modal.

⚠️ **As duas metades andam juntas.** Sem o rótulo, a correção troca um erro silencioso por outro: o
`06:00` de uma linha de turno noturno é indecidível a olho, exatamente como o `HH:MM` de uma batida
num turno de 24h (armadilha 45). E a mudança na tela é **inerte até a migration ser aplicada** —
com o banco antigo o bloco começa no próprio dia, o delta é zero e nada é rotulado —, então não há
problema de ordem entre deploy e migration.

## Portões

- `node scratchpad/sim_hora_eixo_do_dia.js` — **25 casos** de tabela-verdade mais a forma do
  envelope, dos 4 cursores e dos privilégios.

  ⚠️ **Ele não duplica a regra em JS: TRADUZ o corpo SQL de `fn_hora_prevista_dia_seguinte` e roda
  a tabela em cima da tradução.** Uma cópia em JS seria um portão que passa com o SQL quebrado —
  testaria a cópia, nunca o original. Toda linha do corpo precisa casar com um padrão conhecido; se
  aparecer construção nova, o portão **aborta** em vez de ignorar.
- `node scratchpad/val_sim_hora_eixo_do_dia.js` — injeta **10 regressões** e exige reprovação nas
  10 (guard removido, comparador afrouxado, `+24` perdido, cursor deixado para trás, `REVOKE`
  ausente, conferência que deixa de executar…). Cada injeção confere que **mudou o texto** antes de
  rodar — injeção que vira no-op faria o validador "passar" sem ter testado nada.
- `node scratchpad/ver_hora_eixo_aplicada.mjs` — conferência **contra o banco**, executando as
  funções par a par e provando o efeito: o bloco do Extra passa a começar no dia seguinte **e** a
  estar no mesmo bloco do turno noturno (emendou, em vez de virar bloco solto). Sai com código 1 em
  qualquer falha.
- A conferência dentro da migration **executa** `fn_blocos_previstos_dia` (armadilha 42) e confere
  os dois sentidos, mais os privilégios nas duas direções: `anon` fora, `authenticated` mantido em
  `fn_blocos_previstos_dia` (a grade a chama).

## O que NÃO foi feito, e por quê

⚠️ **Não corrige dado já gravado.** As 26 linhas que já têm presença são todas de 08/2026, em folhas
**Revisada** — ponto passado em documento assinado. Mexer nisso é decisão de quem responde pela
folha, por lista fechada e com ensaio antes/depois (armadilha 46), não efeito colateral de uma
migration de regra.

⚠️ **Não foi validada em homologação nesta sessão.** A ponte de deploy (`_deploy_sql` /
`_deploy_run`) que `scratchpad/envia_homolog.mjs` usa foi removida ao fim da última validação e não
estava versionada; não há `DATABASE_URL` de homologação nem `psql` neste ambiente. O SQL da ponte
passou a ser versionado em `scratchpad/_ponte_deploy_homolog.sql` para isso não se repetir.
**A migration não deve ir a produção antes de passar por lá.**

ℹ️ **`fn_obter_horario_regular_dia` ainda não aceita `ÁS` com A agudo** (armadilha de 06/09/2026,
que consertou 13 sítios em TypeScript e não alcançou este). Sem efeito hoje: as duas únicas jornadas
noturnas do catálogo (`18H ÀS 06H` e `19H ÀS 07H`) usam a crase, e nenhuma jornada da base usa o
agudo. Pendência conhecida.
