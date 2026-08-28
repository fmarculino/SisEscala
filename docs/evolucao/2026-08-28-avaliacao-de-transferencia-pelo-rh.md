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

## O que NÃO foi alterado

- **`updateServidor`** continua como estava: `super_admin` e `rh` transferem direto; todos os
  demais — `rh_unidade` incluído — **solicitam**. Ele aprova o próprio pedido em seguida, o que é
  um passo a mais, mas mantém o registro do pedido e do parecer.
- **`historico_transferencias`** ficou de fora. A `FOR ALL` de lá tem a mesma folga
  (`coordenador`/`ass_adm` conseguem inserir), mas aquilo é **log**: escrever nele não move
  ninguém. Fica como pendência conhecida.

## Verificação

- `npx tsc --noEmit` e `npm run build` — limpos.
- `node scratchpad/sim_avaliacao_transferencia.js` — 14 casos de papel/escopo/ação, todos OK
  (transpile antes: `npx tsc src/utils/avaliacaoTransferencia.ts --outDir scratchpad/_sim --module commonjs --target es2020`).
- A migration **confere o próprio resultado** e aborta: nenhuma policy `FOR ALL` pode sobrar,
  tem que existir exatamente **uma** de `UPDATE` (a nova), e as 4 de `SELECT`/`INSERT` continuam
  no lugar.
- ⚠️ **Ainda não aplicada em banco nenhum** — homologação primeiro, produção só com autorização.
