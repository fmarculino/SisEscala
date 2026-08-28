# RH Geral e RH da Unidade passam a avaliar transferência (28/08/2026)

## O pedido

Até aqui, aprovar/rejeitar uma **Solicitação de Transferência / Disponibilização ao RH**
(`/servidores/pendencias`) era exclusividade do Administrador Geral. O usuário pediu que o
**RH Geral** e o **RH da Unidade** também autorizem — o RH Geral em qualquer unidade, o RH da
Unidade **só na própria**.

## O que a mudança encontrou pelo caminho

🚨 **A policy "Avaliacao de solicitacoes_transferencia so super_admin" (`20260811110000`) nunca
restringiu a avaliação.** Policies permissivas se somam com `OR`, e `20260818100000` criou na
**mesma tabela** uma policy `FOR ALL` — *"Permitir gerenciamento de solicitacoes_transferencia
para autorizados"* — que `20260818170000` depois ampliou para `ass_adm`. `FOR ALL` cobre `UPDATE`,
e sem `WITH CHECK` próprio o `WITH CHECK` cai para o `USING`.

Resultado, lido no texto das policies: **`admin`, `coordenador`, `rh_unidade` e `ass_adm` podiam
marcar um pedido como `aprovada`** chamando o PostgREST direto com a sessão deles. O que os
segurava era o `if` da server action — e server action é um POST cujo id sai no bundle
(armadilha 12). É a **armadilha 24 outra vez**: a policy estrita existe, e a permissiva ao lado
dela é que decide.

Por isso a `FOR ALL` saiu e as três operações passaram a ser escritas separadamente. `SELECT` e
`INSERT` mantiveram exatamente o alcance que ela dava (inclusive para `ass_adm`, que só entra na
tabela por ali) — **quem SOLICITA não mudou**. Só o `UPDATE` ficou restrito.

## A regra, em fonte única

**`src/utils/avaliacaoTransferencia.ts`**, aplicada nas três camadas:

| camada | papel |
|---|---|
| `pendencias/page.tsx` | resolve `podeAvaliar` **linha a linha**, no servidor — decide o que a tela mostra |
| `avaliarSolicitacaoTransferencia` (action) | recusa com mensagem legível; distingue "não é seu papel" de "não é sua unidade" |
| `20260828100000` (policy de `UPDATE`) | o que o banco deixa gravar |

| papel | avalia |
|---|---|
| `super_admin`, `rh` | qualquer solicitação |
| `rh_unidade` | dentro das unidades vinculadas a ele |
| demais | não avaliam — continuam **solicitando** |

⚠️ **Para `rh_unidade`, aprovar exige ORIGEM *e* DESTINO no escopo dele.** Não é rigor gratuito:
a policy `Scoped access for Admins and Coordinators` (`20260818100000`) só deixa esse papel
escrever em `servidores` cuja `unidade_id` está em `profile_unidades`, e o `WITH CHECK` roda sobre
a linha **nova** — mandar o servidor para outra unidade seria recusado lá de qualquer forma, e o
sintoma seria *"Nenhuma alteração foi gravada"* sem explicação nenhuma. Transferência **entre**
unidades continua com o RH Geral / Administrador Geral, que enxergam as duas pontas.
**Rejeitar** não escreve em `servidores`, então basta a origem.

⚠️ **`acesso_todas_unidades` não é aceito como bypass para `rh_unidade`.** A policy de escrita de
`servidores` tem esse bypass só no braço de `admin`/`coordenador`; o braço de `rh_unidade` olha
unicamente `profile_unidades`. Honrar a flag aqui liberaria o `UPDATE` da solicitação para depois
o `UPDATE` de `servidores` falhar — pedido marcado como aprovado com o servidor parado no lugar,
que é o defeito de 10/08/2026 (KETTELE) de volta.

⚠️ **O destino é conferido sobre o valor FINAL**, o que veio no pedido **ou** o que o avaliador
acabou de escolher no `<select>` da aprovação. Checar só o do pedido deixaria o RH da Unidade
mandar alguém para fora do escopo dele pelo próprio formulário. Por isso o `<select>` de unidade
de destino, no ramo escopado, oferece só as unidades dele.

## Na tela

O RH da Unidade caía no ramo `isCoordEscopo` de `page.tsx`, que devolvia
`solicitacoesTransferencia={[]}` — ele **não tinha onde clicar**. Esse ramo passou a buscar a
lista (a RLS de `20260812100000` já a escopa; nada é refiltrado em JS) e a renderizar a seção.
Coordenador continua sem ela.

O mapeamento das linhas virou `mapearSolicitacoes()`, no topo do arquivo, compartilhado pelos dois
ramos — duas cópias divergiriam na primeira mudança.

Linha que o avaliador vê mas não pode decidir aparece **sem botão, com o motivo escrito**. Some
da lista seria pior: o pedido existe, é da unidade dele, e sumir sem explicação é o modo de falha
silencioso que este projeto já pagou várias vezes.

## Segunda parte: o setor aparecia só pela folha, e isso estava virando cadastro duplicado

A linha do pedido dizia `HMI - Hospital Materno Infantil / BLOCO A`. **"BLOCO A" existe embaixo de
mais de um pai**, então não dava para saber de qual se tratava — e a saída que estava em uso era
batizar o setor no dicionário de `BLOCO A SHL`, ou seja, escrever a hierarquia dentro do nome,
duplicando no cadastro o que o `parent_id` já sabe.

**`buildSectorPathMap` / `formatSectorPaths` (`src/utils/sectors.ts`)** montam o caminho completo:
`HMI - Hospital Materno Infantil / SHL \ BLOCO A`. Aplicados em `/servidores/pendencias` no texto
solto (linha da transferência, tabela "Servidores sem CPF") e nos dois `<select>` de setor.

⚠️ **Separador é barra invertida de propósito.** A tela já usa `" / "` entre unidade e setor;
repetir a barra normal apagaria a fronteira entre "onde termina a unidade" e "onde começa o
caminho do setor".

⚠️ **Não substituem `formatSectorsHierarchy`, e ela continua onde está.** O recuo com `↳` serve
para lista curta, onde o pai está na linha de cima; o caminho serve para texto solto e para
`<select>` longo, onde o pai sai da tela assim que se rola. As outras 15 telas que usam a versão
em árvore não foram tocadas.

Pai fora da lista (fora do escopo de leitura de quem consulta) começa o caminho nele mesmo —
inventar ancestral que não se pode ler seria pior que mostrar o caminho curto. Ciclo em
`parent_id` para de subir em vez de estourar a pilha.

### Um filtro que nunca filtrou, encontrado no caminho

⚠️ Os dois `<select>` de setor desta tela fazem `.filter(s => s.ativo !== false)` para não
oferecer setor desativado — a consulta busca `ativo`, o comentário no componente explica a regra —
mas **`page.tsx` montava a lista sem repassar o campo**. `undefined !== false` é sempre `true`:
os 17 setores inativos continuavam aparecendo, nas duas seções, desde sempre. Corrigido junto.

**Lição:** ao montar a lista que alimenta um componente que filtra por um campo, confira que o
campo chega lá — o filtro não reclama quando o dado não existe, ele simplesmente aceita tudo.

## O que NÃO foi alterado

- **`updateServidor`** continua como estava: `super_admin` e `rh` transferem direto; todos os
  demais — `rh_unidade` incluído — **solicitam**. Ele aprova o próprio pedido em seguida, o que é
  um passo a mais, mas mantém o registro do pedido e do parecer.
- **`historico_transferencias`** ficou de fora. A `FOR ALL` de lá tem a mesma folga
  (`coordenador`/`ass_adm` conseguem inserir), mas aquilo é **log**: escrever nele não move
  ninguém. Fica como pendência conhecida.

## Verificação

- `npx tsc --noEmit` e `npm run build` — limpos.
- `node scratchpad/sim_avaliacao_transferencia.js` — 14 casos de papel/escopo/ação, todos OK.
- `node scratchpad/sim_caminho_setor.js` — caminho de 3 níveis, duas "BLOCO A" em ramos
  diferentes, órfão, ciclo em `parent_id` e preservação de `ativo`/`unidade_id`, todos OK.
- Transpile antes dos dois:
  `npx tsc src/utils/avaliacaoTransferencia.ts src/utils/sectors.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
- A migration **confere o próprio resultado** e aborta: nenhuma policy `FOR ALL` pode sobrar,
  tem que existir exatamente **uma** de `UPDATE` (a nova), e as 4 de `SELECT`/`INSERT` continuam
  no lugar.
- ⚠️ **Ainda não aplicada em banco nenhum** — homologação primeiro, produção só com autorização.
