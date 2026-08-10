# Validação de documentos (CPF, CNPJ, PIS) — levantamento e plano

**Data:** 09/08/2026
**Origem:** os 4 CPFs com dígito verificador inválido encontrados na auditoria de cadastro único.
**Estado:** **Fases 1–3 implementadas (v1.38.0).** Fase 4 (o `CHECK`) escrita e **aguardando a
correção dos 4 CPFs**. Fase 5 não iniciada.

Medido em produção em 09/08/2026.

---

## 0. O que já está em pé

| fase | o que | onde |
|---|---|---|
| 1 | fonte única TS | [`src/utils/documentos.ts`](../../src/utils/documentos.ts) |
| 1 | funções SQL espelho | `20260809220000` — `fn_cnpj_digito_valido`, `fn_pis_digito_valido`, `fn_documentos_invalidos` |
| 1 | conferência cruzada | `scratchpad/confere_documentos.js` — **137/137 CPFs concordaram** (126 reais + 11 bordas) |
| 2 | aviso no formulário | [`src/components/CampoDocumento.tsx`](../../src/components/CampoDocumento.tsx), em 5 campos |
| 3 | recusa nas actions | `createServidor`, `updateServidor`, `importServidores`, `createUnidade`, `updateUnidade` |
| 4 | o `CHECK` | `20260809230000` — **não aplicar antes de corrigir os 4 CPFs**; a migration aborta sozinha |

### Duas coisas apareceram durante a implementação

**A máscara de CPF existia em quatro cópias** — `servidores/novo`, `servidores/[id]`, e duas em
`UnidadeDadosFiscais`. É o mesmo padrão que fez a checagem de matrícula duplicada existir só no
frontend: regra copiada some de uma tela e ninguém percebe. As quatro viraram `CampoDocumento`.

**`pis_pasep` gravava o valor mascarado.** O campo mantinha no state o texto já formatado
(`000.00000.00-0`) e o enviava assim ao banco — diferente do CPF, que sempre guardou só dígitos.
Não houve estrago porque está 0% preenchido, mas é exatamente o campo que a Fase 9 vai popular
para o casamento com o AFD, onde o auditor procura por PIS/NIS. Máscara gravada quebraria esse
casamento do mesmo jeito que o zero à esquerda do CPF quebra (armadilha 10). Corrigido junto.

**O `CHECK` de `unidades` que já existia não valida dígito.** `chk_unidade_cnpj`
(`20260807120000`) confere só `^[0-9]{14}$` — aceita 14 dígitos quaisquer. As constraints novas
são de dígito e **convivem** com as de formato; nenhuma substitui a outra.

---

## 1. O que existe hoje

| campo | preenchidos | inválidos | com máscara gravada |
|---|---|---|---|
| `servidores.cpf` | 126 / 183 | **4** | 0 |
| `unidades.cnpj` | 16 / 16 | **0** ✓ | 0 |
| `unidades.responsavel_cpf` | 0 / 16 | — | — |
| `servidores.pis_pasep` | 0 / 183 | — | — |
| `servidores.rg_numero` | 0 / 183 | — | — |

**Validação existente: nenhuma.** Há **máscara** de digitação no formulário de servidor
(`novo/page.tsx` formata `000.000.000-00` enquanto se digita) e normalização para dígitos no
`unidades/actions.ts` — mas nada confere o dígito verificador, em nenhuma camada: nem no cliente,
nem na server action, nem no banco.

A única função de dígito que existe é `fn_cpf_digito_valido`, criada em `20260809110000` — e ela
foi feita **de propósito** como consulta, não como `CHECK`, porque os 4 CPFs inválidos já estavam
gravados e um `CHECK` travaria a edição dessas quatro pessoas.

### ✅ Cartão SUS ficou fora — decidido

`cns` / `cartao_sus` **não existe em nenhuma tabela**. Você confirmou em 09/08/2026 que a menção
foi força do hábito e que, não havendo o campo, não é para criá-lo. Fora do escopo.

Se um dia entrar, ele **tem** dígito verificador (soma ponderada de 15 posições, múltipla de 11,
com regra distinta para os que começam em 1/2 e em 7/8/9) e a validação sai junto com as outras.

### O `pis_pasep` merece atenção à parte

Está **0% preenchido**, mas o CLAUDE.md registra que **auditor fiscal casa por PIS/NIS**, e o
preenchimento dele é projeto da Fase 9 do módulo REP. Vale já nascer validado: PIS tem dígito
verificador próprio, e começar a preencher 183 registros sem conferência repetiria exatamente o
problema que estamos corrigindo agora com o CPF.

---

## 2. Os quatro CPFs inválidos — o que fazer com eles

```
HUGO MARCELO OSORIO                15473729253
MICHELLE RAIANNE MORAIS DA SILVA   00700922228
FRANCISCA ASSIS ALMEIDA SANTOS     66871107315
LUCILIA LIMA AZEVEDO               60230476268
```

Eles **não podem ser corrigidos por dedução.** Um dígito verificador errado significa que algum
algarismo está errado — mas não diz qual. `15473729253` pode ser `15473729254` (dígito trocado) ou
`15473729153` (um dígito do meio trocado): não há como saber sem olhar o documento.

**A correção é administrativa, não técnica:** conferir o CPF de cada um na ficha e corrigir o
cadastro. São quatro pessoas.

Isto importa para o plano porque decide a ordem: **o `CHECK` só pode entrar depois que os quatro
estiverem corrigidos** — senão qualquer edição no cadastro dessas pessoas passa a falhar, inclusive
alterações que nada têm a ver com o CPF.

---

## 3. Onde a validação precisa estar — e por que em três lugares

Este projeto já aprendeu duas vezes que uma camada só não basta:

- a checagem de matrícula duplicada existia **só no frontend** e a RLS a cegava
  (`20260807110000`);
- o Portal do Servidor desabilitava o input da folha, mas a action era chamável direto
  (v1.23.0).

| camada | papel | o que acontece sem ela |
|---|---|---|
| **Cliente** | avisa enquanto digita | a pessoa só descobre o erro ao salvar, e às vezes nem aí |
| **Server action** | recusa com mensagem útil | importação CSV e chamada direta passam batidas |
| **Banco (`CHECK`)** | a garantia | `INSERT` no SQL editor, script de migração e qualquer caminho futuro escapam das outras duas |

O `CHECK` é o único que sobrevive a um deploy que esqueça a validação — o mesmo raciocínio do
índice único de CPF em `20260809110000`.

---

## 4. Plano

### Fase 1 — Fonte única da regra, em dois lugares que não podem divergir

O algoritmo do dígito precisa existir em TS (cliente e action) e em SQL (`CHECK`). São duas
implementações inevitáveis — o que **não** pode haver é uma terceira, nem divergência entre elas.

**TS:** `src/utils/documentos.ts` com `validarCpf`, `validarCnpj`, `validarPis`, `normalizarDoc` e
`formatarDoc`. Um só módulo, importado por formulário e action.

**SQL:** `fn_cpf_digito_valido` já existe. Faltam `fn_cnpj_digito_valido` e `fn_pis_digito_valido`,
na mesma forma.

**Conferência cruzada:** um script em `scratchpad/` que roda as duas implementações sobre os 126
CPFs e os 16 CNPJs reais e **aborta se discordarem em qualquer um**. É o mesmo mecanismo dos
geradores de migration — sem ele, TS e SQL divergem em silêncio.

### Fase 2 — Cliente: avisa, não bloqueia

Feedback ao sair do campo: borda âmbar e *"CPF inválido — confira os dígitos"*. **Não impedir a
digitação** e não bloquear o `submit` só por isso: quem está digitando um CPF pela metade não pode
ser interrompido, e um formulário que trava sem explicar é pior que um que avisa.

### Fase 3 — Server action: recusa

`createServidor`, `updateServidor`, `importServidores` e `updateUnidade` passam a recusar documento
com dígito inválido, com mensagem que diz **qual campo** e — na importação — **qual linha**.

⚠️ Na importação em massa, a mesma regra do CPF duplicado: **cancelar o arquivo inteiro apontando
as linhas**, em vez de importar metade.

### Fase 4 — Banco: o `CHECK`, **depois** de corrigir os quatro

```sql
ALTER TABLE public.servidores
  ADD CONSTRAINT chk_servidores_cpf_valido
  CHECK (cpf IS NULL OR public.fn_cpf_digito_valido(cpf));
```

A migration **aborta** se ainda houver CPF inválido gravado, com a lista de quem é — em vez de
falhar com uma mensagem críptica do Postgres. Mesma forma para `unidades.cnpj` (que já está 100%
válido, então entra sem pendência) e `unidades.responsavel_cpf` (vazio, entra sem risco).

`pis_pasep` entra junto, aproveitando que está vazio: nasce protegido.

### Fase 5 — Tela de pendências de cadastro

Reaproveita `fn_possiveis_duplicidades_servidor` (que existe e ninguém chama) e soma os documentos
inválidos e ausentes. Uma tela só respondendo *"o que está errado no cadastro"*:

- CPF inválido · CPF ausente (57 hoje) · PIS ausente (183) · duplicidade provável

Sem isso, os 57 sem CPF continuam invisíveis até alguém rodar SQL — e eles são a única porta de
duplicação que o índice único não fecha.

---

## 5. O que **não** vou fazer, e por quê

- **Não tornar CPF obrigatório agora.** 57 servidores (31%) estão sem, e exigi-lo travaria a
  edição de um terço da base. Vira decisão depois da Fase 5, quando o buraco estiver visível e
  quantificado.
- **Não validar RG.** RG não tem dígito verificador padronizado no Brasil — cada estado emite de um
  jeito. Validar seria inventar regra.
- **Não criar campo de Cartão SUS por conta própria.** Ver § 1.
- **Não "corrigir" os quatro CPFs por dedução.** Ver § 2.

---

## 6. Ordem sugerida

| # | passo | estado |
|---|---|---|
| 1 | `src/utils/documentos.ts` + funções SQL + conferência cruzada | ✅ v1.38.0 · migration `20260809220000` |
| 2 | validação no cliente (avisa) | ✅ v1.38.0 |
| 3 | validação nas server actions (recusa) | ✅ v1.38.0 |
| 4 | **você corrigir os 4 CPFs** na ficha | ⏳ você |
| 5 | `CHECK` no banco | 📝 `20260809230000` escrita, aguarda o passo 4 |
| 6 | tela de pendências de cadastro | ⬜ não iniciada |

Os passos 1 a 3 já impedem que **novo** dado inválido entre — que era a pergunta central. O
passo 5 fecha as portas que sobram, e ele espera por você.

---

## 7. Como rodar a conferência cruzada

```bash
node scratchpad/confere_documentos.js
```

Compila `src/utils/documentos.ts` com o `tsc` do projeto e roda **esse** código contra as funções
SQL, sobre todos os documentos reais de produção mais as bordas sintéticas. Sai com **exit 1** em
qualquer divergência. Só faz `SELECT` e chamada de função `IMMUTABLE`.

Ele **não** reescreve o TS em JS de propósito: reescrever criaria uma terceira implementação, e
seria ela — não a que roda em produção — a conferida.

Resultado em 09/08/2026, antes de `20260809220000` ser aplicada:

```
CPF    137/137 concordaram (126 de produção, 11 sintéticos)
CNPJ  — pulado (função SQL ausente)
PIS   — pulado (função SQL ausente)
```

**Rode de novo depois de aplicar a migration** — CNPJ e PIS ainda não foram cruzados.
