# Revezamento de vigias na portaria (04/09/2026)

Relato do usuário, olhando a escala de agosto/2026 da PORTARIA da USF ENFERMEIRA ZEZINHA:

> temos uma situação nas escalas que é muito confusa pra maioria das pessoas, é a escala dos
> vigias agente de portaria das unidades, geralmente são 2 servidores que trabalham se revezando
> entre si (...) quero saber se tem como criar uma automação na escala ou seja um template pra
> facilitar essa escala lembrando que tem os feriados e pontos facultativos

## A regra, depois de reduzida

A descrição inicial era um caminho de sexta a segunda, contado hora a hora. O usuário resumiu
sozinho o que estava por trás:

> os vigias em dias normais trabalham 12hs + 1h extra e nos sabados domingos, feriados e pontos
> facultativos eles trabalham 24hs e na virada pro dia normal é 24h + 1hr extra

Isso é **uma regra de calendário e nada mais**. A "forma" do turno depende só do tipo do dia (e do
tipo do dia seguinte):

| dia | dia seguinte | lançamento |
|---|---|---|
| normal (tem equipe do dia) | — | `Regular = N` + `Extra` (1h) |
| sem equipe | sem equipe | `Regular = N` + `Plantão = MT` (24h) |
| sem equipe | normal (**virada**) | `Regular = N` + `Plantão = MT` + `Extra` (1h) |

⚠️ **Não existe rodízio separado para fim de semana, e essa foi a descoberta que barateou tudo.**
O caminho descrito pelo usuário — o mesmo agente pegando sexta **e** domingo, com o outro cobrindo
só o sábado — não precisa de regra nenhuma: é o que a alternância simples produz sozinha quando o
bloco sem-equipe tem exatamente 2 dias.

```
qui  sex  sáb  dom  seg      alternância simples, um por dia civil
 B    A    B    A    B
      │    │    │
      │    │    └─ 24h + 1h extra (virada: segunda é normal)
      │    └────── 24h, sem extra (domingo também é sem equipe)
      └─────────── 12h + 1h extra (dia normal)
```

Confirmado com o usuário antes de desenhar, e generaliza sem código novo para bloco maior (feriado
emendado no fim de semana) e para **mais de 2 agentes** — em unidade grande são 3 ou 4, e o
round-robin só muda de tamanho.

## O que já existia (e por que não servia)

`src/utils/scaleTemplates.ts` tem 4 modelos (12×36, 12×48, 5×2, 6×1). Todos são **um servidor, um
turno, uma linha**: `generateTemplate` devolve `Record<dia, turnoId>` e o modal escreve só a
categoria `Regular`. Nenhum deles olha feriado — `generate5x2` usa o dia da semana do calendário,
os outros três são ciclos puros de contagem de dias.

Os códigos necessários **já estavam cadastrados**, então nada de dicionário novo:

| código | descrição | tipo | âncora |
|---|---|---|---|
| `N` | NOITE: 12HRS | Normal,Plantão | 19:00 |
| `MT` | MANHÃ: 6HRS, TARDE: 6HRS | Normal,Plantão,Extra | 07:00 |
| `1N` / `1` | 1 Hora Extra Noturna / Diurna | Extra | **nenhuma** |

E a combinação `Regular = N` + `Plantão = MT` no mesmo dia **já é a convenção praticada à mão** na
escala real da unidade — a automação replica o que o coordenador já faz, não inventa um formato
novo.

## O que foi construído

**`src/utils/vigiaRevezamento.ts`** (módulo puro, sem I/O) e um modal **"Revezamento de Vigias"**
em `ScaleGrid.tsx`, ao lado de "Aplicar Template" — não o substitui, porque os 4 modelos antigos
continuam servindo para escala de um servidor só.

O modal exige **prévia dia a dia antes de aplicar**: data, tipo do dia, quem fica de plantão,
quais turnos, e a hora da extra. Isso não é enfeite — ver "o que conta como dia sem equipe".

Guards reaproveitados **como estão**, um por agente/dia, na mesma ordem do "Aplicar Template":
`hasPresenceForDay` → `getAfastamentoBloqueante` → `encontrarConflitoExterno` → `avaliarCarga`.
`handleSave` continua sendo a barreira final contra o banco. **Nenhuma migration.**

## O que conta como "dia sem equipe"

Feriado (tabela `feriados`, institucional) e ponto facultativo **de dia inteiro** contam; ponto
facultativo **parcial** (saída antecipada / entrada tardia) não, porque a equipe do dia ainda
esteve lá parte do expediente.

⚠️ **`ponto_facultativo_setores` NÃO é consultado, de propósito.** Aquele mapeamento
(incluído/excluído por setor) responde se **aquele setor** libera o próprio pessoal — a portaria
é justamente o setor que **não** é liberado. A pergunta que importa aqui é outra: se a equipe
diurna da unidade está de folga, obrigando o vigia a cobrir o dia. Não existe função reutilizável
que responda isso (a única lógica parecida vive dentro de `fn_confirmar_presenca`, para outro fim),
então a regra é uma aproximação institucional — e a prévia é o que a torna segura.

## Os quatro bugs achados na revisão da própria implementação

A primeira versão passou em `tsc`, no build e num portão de 12 blocos de simulação. A revisão
crítica seguinte achou quatro defeitos, **três deles silenciosos**.

### 1. A hora extra ia sem hora (grave)

`1N` **não é ancorado** (`horario_inicio` nulo). Quando o coordenador lança essa célula à mão,
`precisaHoraInicio` é verdadeiro e a grade **abre um modal pedindo a hora**, sugerindo o fim da
jornada (`06:00`, para a jornada `18H ÀS 06H`) — é esse `06:00` que aparece na linha EXTRAS da
escala real.

A automação pulava esse passo. Efeito: **toda** célula de extra sairia como `?h` na grade, e
`hora_inicio_prevista` iria **NULA** ao banco — o previsto daquela hora deixaria de ser
06:00→07:00 e passaria a sair da cascata legada (armadilha 4), que é o que alimenta terminal e
reconciliação. E o coordenador teria que abrir 15 a 30 células na mão, anulando a automação.

Agora a hora vem de `horaExtraPassagemTurno(nomeJornada)` — o mesmo valor que `sugerirHoraInicio`
propõe hoje — e **aparece na prévia**. Quando o nome da jornada não diz a hora, devolve `null` e a
célula fica `?h`: visível para resolver, em vez de um horário inventado.

### 2. Hora órfã sobrevivia nos dias reescritos

A aplicação limpava os turnos dos dias reescritos, mas não as **horas**. Uma hora informada de um
turno anterior no mesmo dia continuaria lá — e o upsert manda `hora_inicio_prevista` para toda
categoria que aceita hora (Plantão e Extra), então ela **sobreporia a âncora das 07:00 do `MT`**,
porque o nível 1 da cascata vence todos os outros. `handleCellChange` já limpa nesse caso; este
caminho não limpava.

### 3. Slots errados na checagem de afastamento

O guard conferia sempre a união `M+T+N`. Uma declaração de comparecimento **só de manhã** esvaziaria
um dia em que o agente só trabalharia à noite. Agora `slotsDoDiaVigia` devolve `['N']` no dia normal
e `['M','T','N']` no de 24h — os slots reais daquele dia.

### 4. O turno não era conferido contra o `tipo` da linha

O input da célula só aceita código cujo `tipo` contenha o tipo da linha (`Normal`/`Plantão`/`Extra`).
O caminho novo escrevia sem conferir: uma edição no Dicionário de Turnos produziria um lançamento
que **a própria tela recusaria na digitação**. `validarTurnosVigia` fecha isso.

## A decisão que era do usuário, não do código

A primeira versão fixava `1N` ("1 Hora Extra **Noturna**") no código-fonte. **Isso define o
percentual pago** — noturna 100%, diurna 50% (`calculateTotals` classifica por
`codigo.includes('N')`) — e a hora em questão, 06:00→07:00, está **fora** da faixa noturna legal
(22h–05h).

Fixar isso no código é decidir sobre dinheiro de servidor público a partir de uma leitura de
screenshot. Os três turnos (noite, dia inteiro, extra de passagem) passaram a ser **escolhidos na
tela**, com `N`/`MT`/`1N` apenas pré-marcados e um aviso explícito sobre o percentual. De quebra, é
isso que torna o modelo realmente reutilizável em unidade que use outros códigos.

## Duas coisas que a prévia passou a mostrar

- **Projeção de carga por agente.** Com dias de 24h o teto de 300h estoura fácil; antes, o
  coordenador só descobriria ao clicar "Aplicar" e ver a operação inteira recusada. A projeção usa
  o **mesmo caminho** da aplicação (`montarGradeRevezamento`) — duas contas para a mesma pergunta é
  como a tela passa a discordar de si mesma.
- **Vigia fora da seleção escalado nos mesmos dias.** A limpeza só alcança quem foi marcado; um
  terceiro agente esquecido continuaria escalado junto com quem está na vez — dois na portaria no
  mesmo dia, sem nada reclamar (a trava do banco barra o mesmo servidor em setores **diferentes**,
  não dois servidores no mesmo setor). O aviso lista nome e dias.

## Decisões registradas

- **Dia pulado não redistribui a vaga.** Presença confirmada, afastamento ou conflito de setor
  deixam o dia sem ninguém e o revezamento **avança** para o próximo agente no dia seguinte.
  Redistribuir criaria uma segunda regra de rodízio; o dia fica marcado na prévia como "revise
  manualmente".
- **Dia pulado não é tocado por ninguém** — nem a limpeza chega nele. É o que a prévia promete.
- **`Sobreaviso` nunca é tocado.** Não faz parte deste revezamento.
- **Só a competência aberta na tela**, como o "Aplicar Template" de um servidor. Gerar meses
  seguintes em lote fica para depois: o caminho de meses extras (`persistirMesesGerados`) tem
  guards mais fracos e merece decisão própria.
- **Relata o que MUDOU**, célula a célula (turno *e* hora), contra a grade viva — não o que o
  gerador calculou (armadilha 22). Zero alterações vira aviso, não "sucesso".

## Verificação

`scratchpad/sim_revezamento_vigias.js` — 15 blocos: alternância com 2 e 3 agentes, o caminho
sexta→segunda do relato, feriado emendado formando bloco de 3 dias, facultativo parcial × de dia
inteiro, início e fim de mês em dia sem-equipe (olhando 1 dia além de cada ponta), dia pulado com
avanço do revezamento, validação de turno por `tipo`, hora da extra e slots por tipo de dia.

**Validado injetando regressões de propósito**, duas rodadas: primeiro "extra sempre presente no
dia de 24h" (reprova), depois as três correções acima desfeitas de uma vez — slots voltando à união
`M+T+N`, hora da extra nunca resolvida e validação sem conferir `tipo`. As três reprovam, em 7
asserções.

`npx tsc --noEmit` limpo e `npm run build` compilando.

⚠️ **Não testado no navegador** — a sessão que escreveu isto não tem como autenticar no sistema. A
prévia obrigatória é o que cobre esse buraco: nada é gravado sem o coordenador conferir a tabela
dia a dia antes.
