# O teto de 300h era da grade, e a pessoa tem várias escalas

**28/08/2026.** Diário da sessão que fechou o buraco. Plano e medições em
[`docs/planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md`](../planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md).

---

## Como apareceu

O usuário estava montando setembro/2026 no HMI e reparou que **JEANE CONCEICAO SILVA** aparecia em
duas grades: `SHL \ LAVANDERIA` com **120h** de previsão e `SHL \ ACOLHIMENTO` com **289h**. As duas
telas mostravam um número dentro do teto de 300h. Somados, **409h**.

A pergunta dele foi exata: *"o sistema não está considerando esse caso, e quando a pessoa está em
mais de uma escala, seja entre unidades ou entre setores, precisa identificar isso, avisar quando a
hora for ultrapassada, e dizer onde está essa informação para quem está lançando saber o que causou
e tomar a decisão correta."*

## O que o código dizia

O teto existe desde `20260811140000`. Cinco fatos, lidos antes de qualquer medição:

1. `handleCellChange` simulava contra `calculateTotals(servidorId)`, que soma o `gridData` **daquela
   grade**. Escala em outro setor era invisível.
2. **`handleCellChange` era o único chamador da checagem em todo o repositório.** `grep -n
   handleCellChange ScaleGrid.tsx` devolvia duas linhas: a definição e o `<select>` da célula.
   Aplicar Template, Gerador Inteligente e `persistirMesesGerados` nunca consultaram o teto — nem
   dentro do próprio setor.
3. **Não existia nada no banco.** Nenhum trigger, nenhuma função. `max_horas_escala_servidor`
   aparecia em **uma** migration: a que cria a chave.
4. `excecoes_escala_servidor` tinha chave `(servidor, unidade, mês, ano)` — sem lugar para uma
   autorização que valesse para a pessoa.
5. O modal de autorização comparava contra `totals.totalPlanejado`, o mesmo número parcial.

É a **armadilha 14 e a 23 num terceiro eixo**: lá o furo do Aplicar Template era afastamento
(fechado em `20260820120000`) e sobreposição entre setores (`20260826220000`); aqui era carga
horária, e sem rede de segurança no banco.

## O que a medição mostrou (leitura de produção autorizada)

1.599 escalas mensais, 24.610 linhas de `escala_diaria`, competências 06 a 10/2026.

| competência | servidores em 2+ escalas |
|---|---|
| 06/2026 | 3 |
| 07/2026 | 2 |
| 08/2026 | 2 |
| **09/2026** | **49** |
| 10/2026 | 0 |

⚠️ **O caso não era antigo — ele estava nascendo.** Dos 49, 11 tinham horas em mais de uma escala.
Três estouravam o teto **só somando**: JEANE 409h, EDIVONETE 314h, ERIKA SOUZA 302h. Todas HMI,
todas em Rascunho.

Duas escalas individuais de 07/2026 (WILKENS 313h, AGNA 302h, LACEM) já passavam de 300h numa grade
só, mas são **Fechadas** e anteriores à criação da regra em 11/08/2026. Não são evidência de que a
trava por célula falhou.

✅ **`excecoes_escala_servidor` tinha 0 linhas em produção inteira.** Em um ano, ninguém exerceu o
teto uma vez sequer. É isso que tornou a mudança de chave da tabela gratuita.

ℹ️ `max_sobreavisos_escala_servidor` valia **20**, não 10 — foi alterado pela tela desde a
migration. O default do código (10) nunca chegou a valer, e a função nova lê o valor real.

🚨 **A lista cresceu enquanto o código era escrito.** Remedido no fim da tarde do mesmo dia:
**NANCI IRAIDES OLIVEIRA MAGALHAES (8736) 326h** (`SND \ COPEIRO/COZINHEIRO/ASG` 218h +
`SHL \ ROUPARIA` 108h) e **MARIA KEDMA DE SOUSA (8273) 314h** (`SHL \ ACOLHIMENTO` 290h +
`SHL \ BLOCO B` 24h). Os servidores em 2+ escalas com carga em 09/2026 foram de 14 para 18 em
poucas horas — de 3 casos acima do teto para 5, sem que ninguém fosse avisado de nada.

## Decisões do usuário

| decisão | escolha | por quê |
|---|---|---|
| escopo do teto | **da pessoa no mês**, somando todas as escalas | é o que o limite sempre significou |
| escopo da autorização | **uma por (servidor, mês, ano)** | duas unidades concedendo +100h cada elevariam o teto a 500h sem ninguém decidir isso; somar apaga o teto, pegar a maior faz o teto depender de quem agiu primeiro |
| ao estourar | **o mesmo comportamento de hoje, agora consolidado** | admin autoriza, os demais são recusados — só que com a conta certa e dizendo onde estão as horas |

## O que foi construído

**Banco** (`20260828120000`): `fn_carga_mensal_servidor` (uma linha por escala, com caminho completo
do setor), `fn_teto_carga_servidor` (global + autorização) e `fn_setor_caminho` (espelho SQL de
`buildSectorPathMap`). As duas primeiras recebem **lista** de servidores — uma chamada por linha da
grade seriam dezenas de requisições por carregamento. A chave da autorização virou
`(servidor, mês, ano)`, com a migration abortando se achasse duplicata.

**Frontend** (`src/utils/limiteCargaMensal.ts`, fonte única): os quatro caminhos de escrita passaram
a conferir — célula, Aplicar Template, Gerador Inteligente, `persistirMesesGerados` — mais a barreira
do "Salvar Previsão", que **relê do banco**. A coluna TOTAL H/MÊS ganhou as linhas **Outras** e
**Mês**, com tooltip listando `UNIDADE / SETOR — Nh`, e fica vermelha acima do teto. Escudo vermelho
na linha do servidor abre a Autorização Extraordinária. E o aviso mais barato de todos: ao
**adicionar** o servidor à grade, antes de lançar o mês dele.

**Relatório** (`20260828130000` + `/relatorios/carga-consolidada`): quem está em 2+ escalas na
competência, o total, o teto e a composição — porque a checagem dentro da grade só aparece para quem
abre justamente uma das duas grades.

## Decisões de desenho que precisam sobreviver

- ⚠️ **A escala DESTA grade é excluída da carga vinda do banco e substituída pelo total local.** O
  banco tem o que foi salvo, a grade tem o que está sendo lançado — somar os dois conta o mesmo turno
  duas vezes. Mesmo motivo de `encontrarConflitoExterno` receber `escalaMensalId`.
- ⚠️ **`decomporPlantao` NÃO é replicada no SQL, e tentar isso é o erro.** O total de
  `calculateTotals` é `pl12*12 + pl6*6 + pl4*4 + avulso`, que é **exatamente `SUM(horas_computadas)`**.
  As unidades PL existem para as colunas de pagamento, nunca para o total — somar por faixa de
  duração ali reintroduziria o bug de 21/08/2026 (44 dos 53 códigos contando errado) dentro da trava.
- ⚠️ **Não há trigger no banco, e isso é decisão.** O comportamento é aviso + autorização; um trigger
  duro exigiria a exceção gravada **antes** do upsert em lote, invertendo a ordem do fluxo (o admin
  só descobre o excesso ao salvar). Consequência assumida: a barreira do `handleSave` é a **última**
  defesa, então ela **recusa em caso de falha de rede** — ao contrário da de sobreposição entre
  setores, onde o `catch` pode deixar passar porque o trigger segura.
- ⚠️ **Aplicar Template e Gerador Inteligente são tudo ou nada.** Preencher "até bater no teto"
  entregaria meio mês escalado com o corte num dia arbitrário. O gerador só recusa quando o resultado
  **piora**, e nomeia os servidores recusados dizendo onde estão as outras horas — o teto é o único
  motivo de recusa que depende de **outra escala**, e sem dizer isso o coordenador olha a própria
  grade, vê espaço sobrando e não entende nada (armadilha 22).
- ⚠️ **`calculateTotals` ganhou um segundo parâmetro `override`** para simular um lançamento antes de
  escrevê-lo. Sem ele, Template e Gerador teriam que reimplementar a fórmula de horas — inclusive o
  teto líquido da jornada, que é fácil de esquecer.
- ⚠️ **`fetchExcecoesEscala` perdeu o filtro por unidade.** Com a autorização valendo para a pessoa no
  mês, filtrar faria uma grade ignorar a autorização concedida a partir do outro setor e recusar um
  lançamento já autorizado.

## Conferido em produção, depois de aplicar

| checagem | resultado |
|---|---|
| `fn_carga_mensal_servidor` para a JEANE, 09/2026 | `120h` + `289h` = **409h** — os mesmos números das duas telas |
| caminho do setor | `SHL \ LAVANDERIA`, com o separador do frontend |
| `fn_teto_carga_servidor` | 300h e **20 un** (o valor real da config, não o default 10), uma linha por servidor pedido |
| lote | 25 servidores numa chamada, 1 linha de teto por servidor |
| chave nova da autorização | duas exceções de sonda para o mesmo servidor/mês em unidades diferentes: a segunda recusada com **409**; sonda apagada |

ℹ️ **`fn_carga_mensal_consolidada` devolve 0 linhas para a service_role.** Não é defeito de uso: o
escopo passa por `fn_unidade_no_escopo`, que exige `auth.uid()`, e a tela chama com a sessão do
usuário. Mas o guard de papel da função **bypassa** quando `auth.uid() IS NULL` e o de escopo não —
uma inconsistência interna que torna a função indepurável por fora. Fica como pendência pequena.

## Pendências

- ⚠️ **Os casos acima do teto precisam ser resolvidos**, senão os setores deles não conseguem salvar:
  8 setores do HMI em 09/2026 e a TI da SMS em 08/2026 (FERNANDO, 23 un de sobreaviso contra teto de
  20). Os dois casos do LACEM não travam nada — 06 e 07/2026 são competências encerradas.
  Rode `node scratchpad/an_limite_horas.mjs` para a lista do momento; ela está viva.
- ⚠️ **O motor de compliance tem o mesmo ponto cego e continua com ele.** `runComplianceCheck`
  (`complianceEngine.ts`) recebe só o `gridData` local: **interjornada e DSR não enxergam o outro
  setor**. A mesma pessoa pode ter `MT` num setor e `N` no outro em dias vizinhos sem nenhum dos dois
  alertas disparar. Mesmo defeito, eixo diferente, fora do escopo desta correção.
- ℹ️ Consistência do bypass de service_role em `fn_carga_mensal_consolidada` (acima).

## Portões

- `node scratchpad/sim_limite_carga.js` — 45 casos sobre `limiteCargaMensal.ts`. Transpile antes com
  `npx tsc src/utils/limiteCargaMensal.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
- `node scratchpad/an_limite_horas.mjs` — medição em produção: quem está acima do teto consolidado.
- `node scratchpad/confere_20260828120000.mjs` — conferência das migrations contra produção.
