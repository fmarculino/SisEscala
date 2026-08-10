# v1.38.0 — Validação de documentos (CPF, CNPJ, PIS)

**Data:** 09/08/2026
**Plano:** [`docs/planos/2026-08-09-validacao-de-documentos.md`](../planos/2026-08-09-validacao-de-documentos.md)
**Migrations:** `20260809220000` (aplicar), `20260809230000` (**aguarda correção dos 4 CPFs**)

---

## O que motivou

A auditoria de cadastro único encontrou **4 CPFs com dígito verificador inválido** entre os 126
preenchidos. A investigação mostrou por quê: o sistema tinha **máscara** de digitação e
**nenhuma validação de dígito em camada alguma** — nem cliente, nem server action, nem banco.

Máscara faz o dado *parecer* certo. `123.456.789-00` está bem formatado e não é um CPF.

---

## O que mudou

### Uma fonte única em TS, uma em SQL, e um script que as cruza

O algoritmo precisa existir em dois lugares — o formulário precisa da versão TS, o `CHECK`
precisa da versão SQL. Duas implementações são inevitáveis; divergirem em silêncio, não.

`scratchpad/confere_documentos.js` **compila `src/utils/documentos.ts` com o `tsc` do projeto** e
roda esse código contra as funções SQL, sobre todos os documentos reais de produção mais bordas
sintéticas. Aborta com exit 1 em qualquer discordância.

Ele não reescreve o TS em JS de propósito: reescrever criaria uma terceira implementação, e seria
ela — não a que roda em produção — a conferida.

Resultado antes de `20260809220000` ser aplicada:

```
CPF    137/137 concordaram (126 de produção, 11 sintéticos)
CNPJ  — pulado (função SQL ausente)
PIS   — pulado (função SQL ausente)
```

### Três camadas, cada uma com um papel

| camada | papel | por que sozinha não basta |
|---|---|---|
| `CampoDocumento` | avisa enquanto digita | não bloqueia o submit, e a action é chamável direto |
| server actions | recusa com mensagem útil | um deploy pode esquecer a validação |
| `CHECK` do banco | a garantia | único que sobrevive a `INSERT` pelo SQL editor |

O aviso do cliente é **âmbar e não bloqueia**: dígito inválido aparece assim que o documento fica
completo; "faltam dígitos" só depois do blur. Quem digita o quinto de onze não pode ser
interrompido.

### Descobertas durante a implementação

**A máscara de CPF existia em quatro cópias** — `servidores/novo`, `servidores/[id]` e duas em
`UnidadeDadosFiscais`. É o padrão que fez a checagem de matrícula duplicada existir só no
frontend (`20260807110000`). As quatro viraram `CampoDocumento`.

**`pis_pasep` gravava o valor mascarado.** O state guardava `000.00000.00-0` e mandava assim ao
banco — diferente do CPF, que sempre guardou só dígitos. Sem estrago (está 0% preenchido), mas é
o campo que a Fase 9 do módulo REP vai popular para o casamento com o AFD, onde o auditor fiscal
procura por PIS/NIS. Máscara ali quebraria o casamento como o zero à esquerda do CPF quebra
(armadilha 10). A importação de CSV também passou a normalizar CPF e PIS.

**O `CHECK` de `unidades` que já existia não valida dígito.** `chk_unidade_cnpj`
(`20260807120000`) confere só `^[0-9]{14}$` — aceita 14 dígitos quaisquer. As constraints novas
são de dígito e **convivem** com as de formato.

---

## O que ficou de fora, e por quê

- **RG** — não tem dígito verificador padronizado no Brasil, cada estado emite de um jeito.
  Validar seria inventar regra.
- **Cartão SUS** — o campo não existe em nenhuma tabela. Decidido em 09/08/2026 que não é para
  criá-lo.
- **CPF obrigatório** — 57 servidores (31%) estão sem. Exigir travaria a edição de um terço da
  base. Vira decisão depois da tela de pendências de cadastro.
- **Os 4 CPFs inválidos não foram "corrigidos".** Dígito errado diz que *algum* algarismo está
  errado, não *qual*. `15473729253` tanto pode ser `15473729254` quanto `15473729153`. A correção
  é administrativa — conferir a ficha.

---

## Pendente

1. **Corrigir os 4 CPFs** na ficha:

   ```
   HUGO MARCELO OSORIO                15473729253
   MICHELLE RAIANNE MORAIS DA SILVA   00700922228
   FRANCISCA ASSIS ALMEIDA SANTOS     66871107315
   LUCILIA LIMA AZEVEDO               60230476268
   ```

2. Aplicar `20260809230000` — ela **aborta sozinha** enquanto sobrar algum inválido, listando quem é.

3. Rodar `node scratchpad/confere_documentos.js` de novo: CNPJ e PIS ainda não foram cruzados.

4. Tela de pendências de cadastro (Fase 5) — junta `fn_possiveis_duplicidades_servidor`,
   `fn_documentos_invalidos` e os 57 sem CPF, que são a única porta de duplicação que o índice
   único não fecha.
