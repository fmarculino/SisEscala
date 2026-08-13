# Horário previsto no modal de tratar marcação + filtros na aba Pendências (v1.60.0)

Data: 12/08/2026 · Sem migration — mudança de tela e de Server Action.

## O que estava faltando

O modal "Tratar marcação" (`/marcacoes` → aba Pendências) mostrava:

```
Matrícula: 68108
Batida real: 11/08/2026, 13:31:34
Registro fora da janela prevista, pendente de revisao.

Escala do dia: [ Regular — MT ]
Passo:         [ Entrada ]
Justificativa: ______
[ Gravar horário real como entrada ]
```

Metade da comparação. O coordenador vê **que horas a pessoa bateu**, mas não **que horas ela
deveria ter batido** — e é justamente a distância entre os dois que diz se 13:31 é entrada
atrasada, saída antecipada ou retorno de intervalo. Na prática obrigava abrir a grade em outra
aba para cada pendência, e o campo "Passo" já vinha com `Entrada` selecionado, que é o palpite
errado na maioria dos casos que caem nessa fila.

## O previsto vem do banco, não de regra nova na tela

`fn_blocos_previstos_dia` — a mesma função que o terminal usa para decidir a janela, e que a
grade lê em lote via `fn_blocos_previstos_mes` (Fase 3 do plano de ancoragem). Nenhuma linha de
derivação de horário foi escrita no frontend.

Isso não é preciosismo: o problema que a Fase 3 fechou foi exatamente a grade mostrar 13:00 num
dia em que o terminal exigia 14:00. Repetir o cálculo aqui reabriria o mesmo buraco, agora na
tela onde alguém decide o que vai para a folha.

`buscarEscalasCandidatas` (`marcacoes/actions.ts`) passou a devolver, por escala candidata, o
bloco a que ela pertence:

```ts
{ timezone, escalas: [{ id, categoria, turno_codigo, presenca_confirmada, previsto }] }
// previsto: { bloco_ordem, entrada, intervalo_saida, intervalo_retorno, saida, permite_intervalo }
```

O mapa é `escala_diaria_id -> bloco`, montado a partir de `escala_diaria_ids` (que é array —
um bloco pode conter mais de uma `escala_diaria`).

### Fusão de blocos sai de graça, e é o comportamento certo

Num dia com Regular + Plantão contíguos, `fn_blocos_previstos_dia` devolve **um** bloco com as
duas `escala_diaria` dentro. Conferido em homologação:

```
--- 2026-06-13  escalas no dia: Regular+Plantão
[{"bloco_ordem":1,
  "escala_diaria_ids":["c9d023de-…","b4e297f8-…"],
  "inicio_previsto":"2026-06-13T10:00:00+00:00",
  "fim_previsto":"2026-06-13T22:00:00+00:00",
  "permite_intervalo":false}]
```

As duas opções do `<select>` de escala apontam para o mesmo previsto (07:00–19:00 em
America/Sao_Paulo). Está certo: é uma jornada só para efeito de janela, e é o que o terminal
cobra. Mostrar horários diferentes por categoria seria inventar uma distinção que o motor de
presença não faz.

## O que a tela mostra

Uma tabela de 4 linhas entre a escala e o passo:

| passo | previsto | distância da batida |
|---|---|---|
| Entrada | 07:00 | 6h31 depois |
| Saída do intervalo | não marca intervalo | |
| Retorno do intervalo | não marca intervalo | |
| Saída | 19:00 | 5h29 antes · **mais próximo** |

- A linha do passo atualmente selecionado fica destacada, para a escolha e a consequência
  ficarem na mesma tela.
- `permite_intervalo = false` vira o texto "não marca intervalo", não célula vazia — vazio
  parece dado faltando, e esse é o caso da SMS inteira hoje.
- Previsto que cai no dia seguinte ao da batida (turno cruzando a meia-noite) mostra a data
  junto: `06:00 (12/08)`.

**O sistema continua sem pré-selecionar o passo.** "Mais próximo" é pista visual e nada mais; o
default do campo segue `Entrada`. Deixar o sistema escolher pela proximidade seria classificar
marcação por horário predeterminado — a vedação 2 da Portaria 671/2021, entrando pela porta da
conveniência.

## Filtros e paginação na lista

A lista vinha inteira, sem corte, misturando tratadas e pendentes.

- **Filtro por servidor** — montado a partir das próprias pendências carregadas, não de uma
  consulta nova a `servidores` (a lista já está no escopo certo, por `fn_unidade_no_escopo`).
- **Filtro de situação**, com **"Só pendentes" como padrão**. As tratadas não somem do sistema,
  só saem da frente.
- **15 por página**, com `x–y de z` e navegação.
- A página atual é reancorada (`Math.min(pagina, totalPaginas)`) quando um filtro encurta a
  lista — sem isso a tela fica vazia com resultados existentes.

Tudo no cliente, sobre o que `fn_marcacoes_pendentes_revisao` já devolve. Paginação no servidor
só faz sentido quando o volume justificar; a RPC hoje devolve o escopo inteiro numa ida só e
não tem parâmetro de faixa.

## Dois problemas achados de passagem em `buscarEscalasCandidatas`

Ambos pré-existentes, corrigidos junto porque a função foi reescrita.

**1. Dia derivado no fuso errado.** Era `new Date(ocorridoEmIso).getDate()` — fuso do processo
Node. A VPS roda em UTC, então uma batida às 22:00 de 11/08 (`2026-08-12T01:00Z`) viraria dia
**12** e a tela traria as escalas do dia seguinte. Nunca foi relatado porque as pendências
tratadas até aqui foram todas diurnas. Agora converte por
`Intl.DateTimeFormat('en-CA', { timeZone })` com o `configuracoes_globais.timezone`, que é a
mesma fonte e o mesmo recorte que `fn_marcacoes_pendentes_revisao` usa no `AT TIME ZONE` para
devolver o campo `dia`.

**2. `createAdminClient()` sem checagem de sessão.** Server Action é endpoint alcançável. Com o
client de service role e sem nenhum `auth.getUser()`, a função devolvia as escalas de qualquer
servidor a quem soubesse o UUID, sem RLS. Agora exige usuário autenticado antes de abrir o
client admin.

O client admin **continua necessário**: é ele que faz o guard de escopo de
`fn_blocos_previstos_dia` (`20260812130000`) liberar por `auth.uid() IS NULL`. Com o client de
sessão, um coordenador cujo acesso vem só de setor vinculado cairia no buraco já registrado de
`fn_unidade_no_escopo` (que só olha `profile_unidades`). O escopo real de quem vê a pendência
já foi aplicado antes, em `listarPendencias`.

## O que a auditoria de produção encontrou (12/08/2026, somente leitura)

Autorizada pelo usuário depois de ler o item 1 acima. A pergunta era: o bug de fuso chegou a
gravar horário real no dia errado?

**Não.** `marcacoes_tratamentos` tem 27 linhas (11 `vincular_escala` + 16 `desconsiderar`); das
11 com escala vinculada, **0 com dia divergente e 0 com servidor divergente**.

A exposição era pequena, mas não por defesa do código:

| medida | valor |
|---|---|
| marcações na base | 58.154 |
| com hora local ≥ 21:00 (a faixa que o offset deslocava) | 86 — 0,1% |
| pendências abertas | 74 |
| pendências com hora local ≥ 21:00 | **2** — 12/08 às 21:26 e 21:57, ainda sem tratamento |

As duas são de hoje, do mesmo coordenador de TI que trabalhou até tarde (o caso que originou a
v1.59.0). O motivo real de nada ter acontecido é que **nenhuma unidade em operação tem escala
noturna** — não é que a função se recusasse a escrever errado.

## A correção definitiva: o guard vai para dentro da RPC

Porque a tela corrigida não protege quem não passa pela tela.

`fn_aceitar_marcacao_pendente` recebia `p_marcacao_id` e `p_escala_diaria_id` e não conferia
**nenhuma** relação entre os dois. Ela já lia o servidor da marcação:

```sql
SELECT m.ocorrido_em, m.servidor_id INTO v_ocorrido, v_servidor ...
-- v_servidor nunca mais aparece no corpo inteiro
```

A variável é lida e descartada. A checagem foi pensada e ficou pelo caminho.

Migration `20260812160000`, gerada por `scratchpad/gen_guard_aceitar.js` — cópia mecânica da
versão vigente (`20260808100000`) com dois trechos inseridos, abortando se, removidos os trechos,
o corpo não voltar byte a byte ao original (armadilha 1).

### Os quatro guards, todos antes de qualquer escrita

| # | guard | por quê |
|---|---|---|
| 1 | servidor da escala = servidor da marcação | não existe caso legítimo do contrário |
| 2 | data da escala ∈ [dia local da batida − 1, dia local da batida] | ver abaixo |
| 3 | categoria ≠ Sobreaviso | armadilha 6 |
| 4 | competência não encerrada | |

Os itens **3 e 4 só existiam em `fn_validar_presenca_manual`**. A aba Pendências de `/marcacoes`
chama `fn_aceitar_marcacao_pendente` **direto**, escapando dos dois — dava para gravar presença
em mês congelado. Sobreaviso a constraint `chk_sobreaviso_sem_presenca` já barrava, mas com erro
cru de banco.

### Por que a janela é [D−1, D] e não algo mais apertado

Medido em produção nesta data:

- **Posterior é impossível** → bloqueado. Dos 27 turnos ancorados, o mais cedo começa **07:00**
  (inícios distintos: 07, 11, 12, 13, 14, 15, 16, 17, 19h). Das 17 jornadas, a mais cedo é
  `07H ÀS …`. Nenhuma começa de madrugada, então batida do dia D nunca é a entrada do turno de
  D+1 — que é exatamente a forma que o bug de fuso produzia.
- **D−1 precisa continuar valendo.** As jornadas `18H ÀS 06H` e `19H ÀS 07H` cruzam a meia-noite:
  a batida das 06:05 do dia D é a saída legítima do turno de D−1. É o mesmo alcance do "cursor de
  ontem" de `fn_confirmar_presenca`.

### O que o guard deliberadamente não faz

Não checa se a batida cai **dentro da janela prevista**. Pendência é, por definição, batida fora
da janela — um guard de plausibilidade rejeitaria justamente o caso de uso. A que passo uma
batida distante pertence é juízo do coordenador (Art. 82, parágrafo único). O guard barra o
impossível, nunca o incomum.

`fn_validar_presenca_manual` e `fn_aceitar_tentativa_recusada` **não foram tocadas** — herdam os
guards por delegarem a esta, mesmo padrão de `fn_confirmar_presenca_manual_bulk`.

### Considerado e descartado: `TZ=America/Sao_Paulo` no container

Resolveria a classe inteira de uma vez. Descartado: mudaria em silêncio o comportamento de toda
data derivada em ~40 pontos de `folha-ponto/actions.ts` e `consultar-escala/actions.ts`, num
sistema de ponto em produção, sem nenhum teste automatizado que cubra a diferença. O custo de
verificação não se justifica para uma classe de bug que a auditoria acabou de medir como tendo
causado zero dano. O padrão do projeto — `configuracoes_globais.timezone` explícito, como
`folha-ponto` já faz — continua sendo a regra.

## Verificação

- `npx tsc --noEmit` e `npm run build` — limpos.
- `fn_blocos_previstos_dia` sondada em **homologação** via service role (`p_data` como
  `YYYY-MM-DD`): status 200, timestamps em UTC (`10:00Z` = 07:00 local), `intervalo_*` nulos
  quando `permite_intervalo = false`, e o caso de fusão Regular+Plantão acima.
- Homologação não tem nenhuma unidade com `permite_marca_intervalo = true`, então o ramo de
  intervalo preenchido não foi exercitado contra dado real — só o ramo "não marca intervalo",
  que é o de toda a SMS hoje.
- **Guard simulado em JS sobre produção antes de o SQL ser escrito**: os 11 tratamentos
  existentes passariam todos (0 recusados); das 74 pendências, 73 continuam com escala elegível
  em D ou D−1. A única exceção não é causada pelo guard — é a batida de EMELLY GONÇALVES
  (11/08, `Sem escala agendada para hoje`), cujo servidor não tem **nenhuma** escala em 08/2026,
  caso que a tela já recusa hoje.
- ⚠️ **A migration `20260812160000` ainda NÃO foi aplicada.** Validar em homologação antes de
  produção. A conferência pós-aplicação está no cabeçalho do próprio arquivo.
