# RLS na edição do servidor — v1.41.0

**Data:** 10/08/2026
**Migration:** `20260810100000_remove_orphan_transfer_records.sql`
**Sintoma relatado:** ao salvar a ficha de um servidor, a tela exibia
`new row violates row-level security policy for table "servidores"`.

## O caso concreto

Suemilly Coelho Feitosa (`admin`) editou a ficha de KETTELE DAYANY ALBUQUERQUE MOREIRA NEVES
(matrícula 251510) e mudou o campo **Setor** para "Sem Setor", com o motivo
*"Disponibilizada para RH"*. Duas tentativas, 14:51 e 14:55.

```
SERVIDOR      251510 KETTELE — lotação SMS / DMAC (inalterada: o UPDATE não passou)
QUEM SALVOU   Suemilly Coelho Feitosa | role=admin
              acesso_todas_unidades=false  acesso_todos_setores=false
              setores vinculados: DMAC ; LABORATÓRIOS [inativo]
```

## Por que a RLS recusou

A policy de escrita é `"Scoped access for Admins and Coordinators"` (`20260618080000`), criada
`FOR ALL` **sem `WITH CHECK`**. Nesse caso o Postgres reusa a expressão do `USING` como `WITH
CHECK`. Sem `acesso_todas_unidades` e sem `acesso_todos_setores`, a única via que autoriza é
`setor_id IN profile_setores`:

| | setor | resultado |
|---|---|---|
| linha antiga | DMAC | passa no `USING` → o `UPDATE` alcança a linha |
| linha nova | `NULL` | **reprova no `WITH CHECK`** → erro |

Não é bug de dados nem bundle velho: **remover a lotação é uma operação que a RLS proíbe para
qualquer admin/coordenador escopado por setor** — 20 dos 30 perfis de produção. Só os 4
super_admin e os 6 com `acesso_todos_setores` conseguem.

## A decisão: bloquear, não abrir a policy

Abrir a policy para aceitar `setor_id` nulo faria o servidor **sair do escopo de quem o soltou** —
a linha passaria a reprovar também no `USING`, e nem essa pessoa nem nenhum outro admin escopado
conseguiria editar o cadastro de novo; só super_admin. Não há um único servidor sem setor em
produção, e a lotação é o que sustenta escala, folha de ponto e terminal.

Para o caso real ("disponibilizar para o RH") os caminhos legítimos são **transferir para o setor
de destino** ou **inativar o cadastro informando o motivo** — os dois já existem na tela, e é isso
que a nova mensagem diz.

## Três falhas que a mesma tentativa expôs

### 1. Histórico gravado antes do fato

O `INSERT` em `historico_transferencias` acontecia **antes** do `UPDATE` em `servidores`. Recusado
o `UPDATE`, o registro ficava. Foi por essa impressão digital que o caso foi localizado no banco
antes mesmo de saber o nome da servidora — os registros com `setor_destino_id IS NULL` cujo
servidor continua lotado:

```
29/07 13:09  "Assumiu PSS"             THIELE SAYURI  (segue em DMAC)
29/07 13:11  "Assumiu PSS"             THIELE SAYURI  (segue em DMAC)
30/07 13:20  "assumiu PSS"             THIELE SAYURI  (segue em DMAC)
10/08 14:51  "Disponibilizada par RH"  KETTELE        (segue em DMAC)
10/08 14:55  "Disponibilizada para RH" KETTELE        (segue em DMAC)
```

**A falha vinha de 29/07 e ninguém reportou.** A repetição em minutos é a pessoa tentando de novo
porque a mensagem não dizia o que estava errado. A migration remove os 5; transferência com
destino preenchido não é tocada.

### 2. O caso espelhado falhava em silêncio

A policy de **leitura** é mais larga que a de escrita: `20260626225000` deixa ver quem está
escalado na unidade. Dá para abrir a ficha de um servidor que não se pode gravar. Aí é a linha
**antiga** que reprova no `USING`, e o Postgres não erra — apenas filtra a linha e devolve sucesso
com **zero linhas**. A action seguia para o `revalidatePath` e o `redirect`, e a pessoa via a tela
de sucesso sem nada ter sido salvo. Agora o `.update()` pede `.select('id')` e a ausência de linha
vira erro explicado.

### 3. O formulário apagava a lotação sozinho

Os `<select>` de unidade e setor são controlados por `value={selectedUnidade}` / `value={selectedSetor}`,
mas as listas vêm filtradas por `ativo = true` e por `applyAccessFilters`. Se a lotação atual não
está entre as opções, nenhuma `<option>` casa, o navegador submete `""` → `null`, e
`isLotaçãoChanged` **não detecta**, porque compara o *state*, não o DOM. A submissão passou a levar
o state.

## O que mudou

| correção | onde |
|---|---|
| setor vazio ou fora do escopo recusado com mensagem | `validarLotacaoNoEscopo`, `src/app/(dashboard)/servidores/actions.ts` |
| bloqueio equivalente na tela (criação e edição) | `novo/page.tsx`, `[id]/EditServidorForm.tsx` |
| histórico e limpeza de escalas só **depois** do `UPDATE` | `updateServidor` (bloco movido por script) |
| `UPDATE` de zero linhas deixa de ser "sucesso" | `.select('id')` em `updateServidor` |
| erro cru de RLS nunca chega à tela | `traduzirErroCadastro` (`42501` / `row-level security`) |
| 5 registros órfãos removidos | `20260810100000` |

A validação vive **nas duas camadas** de propósito: a server action é chamável direto, sem passar
por tela nenhuma — mesma razão de `validarDocumentosServidor` e do bloqueio do Portal em v1.23.0.

## Ponto de atenção não corrigido aqui

O perfil da Suemilly tem **LABORATÓRIOS**, um setor **inativo**, entre os setores vinculados. Não
causou este erro, mas é vínculo morto ocupando escopo — vale uma varredura em `profile_setores`
contra `setores.ativo`.
