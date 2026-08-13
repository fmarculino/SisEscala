# Remoção de cadastro no relógio: formato reprovado e confirmado em campo (LACEM, 13/08/2026)

**Versões:** app `1.62.0` · coletor `0.4.4`
**Contexto do dia:** [`2026-08-13-implantacao-lacem-diario.md`](2026-08-13-implantacao-lacem-diario.md)

> **Desfecho (mesmo dia):** o formato aceito é **`{"users":[N]}`** — array de **números** com o
> `pis`. Confirmado no equipamento removendo o usuário de teste, com a relistagem provando que só
> ele saiu: `1 remocao(oes) aceitas pelo rele (formato users:[pis])` → `1 removido(s), 0 nao
> efetivado(s)`. Ele passou a ser o **primeiro** candidato de `formatosRemocao`, para que a
> remoção real nunca comece experimentando em cima de cadastro de servidor. O resto da lista só é
> alcançado num equipamento onde este formato falhar.

## O que aconteceu

Primeira rodada de campo do `higiene-remover`, na LACEM. A tela de Higiene do Relógio marcou 31
cadastros para remoção (todos "sem correspondência com nenhum servidor ativo do SisEscala", o
resíduo do sistema que usava o equipamento antes) e a fila chegou inteira ao coletor. As 31
falharam com a mesma resposta do equipamento:

```
remocao de CLAUDIO LOPES MARCAL (012202056787) falhou: remove_users.fcgi recusou: 'users' em formato incorreto
```

O corpo enviado era `{"users":[{"pis": N}]}` — a aproximação por simetria com `load_users.fcgi`
escrita na Fase 7b, e desde então marcada em `CLAUDE.md`/`rep/client.go` como **nunca confirmada
contra hardware real**. Foi exatamente esse ponto que estourou.

Nada foi perdido: `remove_users.fcgi` é a única chamada destrutiva da cadeia e ela **recusou**, então
o cadastro do relógio ficou intacto e a fila do SisEscala registrou 31 falhas com o motivo.

## A pista que a mensagem dá

O equipamento nomeia o campo **`users`**. Compare com a Fase 7 (12/08/2026), onde `add_users.fcgi`
recusou um CPF de dígito verificador inválido com `'cpf' em formato incorreto` — ali o nomeado era
um campo **de dentro** do objeto. Aqui o inválido é o container: o **tipo dos elementos** de
`users` é que está errado — array de números, não de objetos. Este device também não tem campo
`id` (confirmado na Fase 7): a identidade tem que sair de `code`, `pis` ou `registration`.

## O que mudou

Como o formato certo continua sendo hipótese até rodar contra o hardware, `rep.RemoverUsuario`
deixou de chutar um formato só.

| peça | onde |
|---|---|
| candidatos em ordem (o confirmado `users:[pis]` primeiro; depois `code`/`registration`, objetos, e sem `mode=671`) | `formatosRemocao`, `rep/client.go` |
| descoberta com confirmação por relistagem | `descobrirFormatoRemocao` — cache em `Client.formatoRemocao`, uma varredura por execução |
| conferência final do lote | `ciclo.HigienizarRemocoes` relista e só então confirma no SisEscala |
| teste em cadastro descartável | `coletor-rep remocao-testar` (CLI) |
| "selecionar todos" na tela | `HigieneDispositivoTab.tsx` — 31 cliques viraram 1 |

`UsuarioDispositivo` passou a carregar `Pis`/`Code`/`Registration` como número (o que a API aceita
de volta), e `RemoverUsuario` recebe o usuário inteiro do snapshot, não só o `identificador_afd` —
os candidatos precisam de campos que só existem em `load_users.fcgi`, não na fila do SisEscala.

## Duas regras que não podem sair daí

1. **`ok` do relógio não é remoção.** Um formato pode ser aceito e não apagar nada. A fila só é
   fechada como aplicada depois que a relistagem mostrar o cadastro fora do equipamento; se ele
   continuar lá, vira falha com motivo explícito. O contrário deixaria a tela afirmando que o
   relógio está limpo quando não está — e a tela é o que decide se alguém vai conferir de novo.
2. **Se um candidato apagar quem não era o alvo, a execução aborta na hora.** A conferência é por
   diferença de conjunto antes/depois, não por "o alvo sumiu": um número interpretado como outro
   campo poderia casar com outro usuário, e varrer os 30 pendentes seguintes multiplicaria o
   estrago antes de alguém perceber.

Fora isso, `higiene-remover` continua **só na CLI** (nunca no ciclo automático nem no menu da
bandeja) e a fila do SisEscala continua recusando quem tem `rep_vinculos_servidor` vigente para
servidor Ativo — a UI filtrar não é o que protege.

## Como validar num relógio novo

Numa máquina dentro da rede da unidade, ao lado do `config.yaml` instalado:

```
coletor-rep-cli remocao-testar
```

Cria "SISESCALA TESTE - PODE APAGAR" (matrícula 900000), tenta apagá-lo, imprime o formato aceito
e nunca toca na fila real. Se nenhum candidato funcionar, a saída lista o que cada um respondeu —
é isso que decide o próximo passo. Só depois disso rodar `coletor-rep-cli higiene-remover` sobre a
fila de verdade.

O formato confirmado **não** foi fixado como único: continua sendo o primeiro de uma lista. Fixar
economizaria uma hipótese e custaria a única defesa que existe quando o parque deixar de ser um
modelo só — e a confirmação por relistagem fica de qualquer jeito.
