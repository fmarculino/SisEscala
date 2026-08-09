# Cadastro único de servidor — diagnóstico da duplicação e correção

**Data:** 09/08/2026
**Migration:** `20260809110000_unique_servant_registration_by_cpf.sql`
**Origem:** duplicata encontrada durante o estudo do aviso de ponto por WhatsApp
([2026-08-09-comprovante-de-ponto-por-whatsapp.md](2026-08-09-comprovante-de-ponto-por-whatsapp.md) § 5.4).

---

## 1. O caso

```
T2600019 | cpf 06307223235 | VIVIAN MARTINS MACEDO | criado 2026-08-05 22:33
T2600014 | cpf 06307223235 | VIVIAN MARTINS MACEDO | criado 2026-08-07 17:34
```

Mesmo CPF, mesmo nome, mesmo e-mail (`vivianmacedo665@gmail.com`), mesmo telefone — um com máscara,
outro sem —, mesmo cargo (`ALMOXARIFE_CONTRATADO`), mesmo vínculo, mesma unidade. Diferem apenas em
matrícula, setor e PIN.

**Varredura completa da base (184 servidores ativos): este é o único caso.**

| critério | grupos encontrados |
|---|---|
| CPF idêntico | 1 — a VIVIAN |
| nome normalizado (sem acento) | 1 — a VIVIAN |
| telefone | 1 — a VIVIAN |
| e-mail | 1 — a VIVIAN |
| RG · PIS/PASEP · nome da mãe + nascimento | 0 |
| *fuzzy*: 1º nome + último sobrenome | 2 — a VIVIAN e o grupo `MARIA SILVA` |

O grupo `MARIA SILVA` são **quatro pessoas distintas** (Antonia Oliveira, Simone Oscar, de Jesus
Neves, Marileide Guimarães) — homônimo parcial legítimo, não duplicata.

⚠️ **Limite da varredura, declarado:** `rg_numero` e `pis_pasep` estão **0% preenchidos**, e
`data_nascimento` / `nome_mae` em **1%** — esses cruzamentos não tiveram poder discriminante
nenhum. A conclusão se apoia em nome (100%), telefone (98%), e-mail (90%) e CPF (69%). Para
escapar dela, uma duplicata precisaria diferir no nome **e** no telefone **e** no e-mail.

A base está saudável — mas estava desprotegida.

---

## 2. Causa raiz: a única chave única da tabela é gerada pelo próprio sistema

`servidores` tem `UNIQUE` em `matricula` e **nada** em `cpf`. A migration que criou a coluna
([20260611165000](../../supabase/migrations/20260611165000_add_cpf_to_servidores.sql)) tem uma linha:

```sql
ALTER TABLE public.servidores ADD COLUMN IF NOT EXISTS cpf text;
```

E aí está o mecanismo exato. Quando o cadastro é feito **com a matrícula em branco**, a trigger
`trg_atribuir_matricula_temporaria` ([20260807110000](../../supabase/migrations/20260807110000_fix_temporary_matricula_generation.sql))
gera uma temporária **nova**. Cadastrar a mesma pessoa duas vezes sem matrícula produz duas
matrículas distintas e **nada colide**.

> A única proteção de unicidade que existia é estruturalmente contornada justamente pelo caminho
> mais usado. Há **15 matrículas temporárias** em produção — e as duas da VIVIAN são duas delas.

No código, as três portas de escrita conferiam apenas a matrícula:

| função | conferia matrícula? | conferia CPF? |
|---|---|---|
| `createServidor` | sim (limitada pela RLS) | **não** — `cpf: cpf \|\| null` entrava cru |
| `updateServidor` | sim (limitada pela RLS) | **não** |
| `importServidores` | **não** — insert em lote, só reagia ao erro da constraint | **não** |

### O agravante: a RLS esconde a duplicata de quem está cadastrando

Uma checagem feita do frontend com o cliente do usuário passa pela policy
`"Users can view relevant servers"`, que escopa `servidores` por unidade/setor. **Um coordenador que
não enxerga a outra unidade não acha a duplicata e cadastra de novo** — e a `UNIQUE` é global.

É exatamente a mesma causa raiz da colisão de matrícula corrigida em `20260807110000`. O problema
voltou pela porta do CPF porque o CPF nunca teve constraint nenhuma.

---

## 3. Correção

### 3.1 Banco — `20260809110000_unique_servant_registration_by_cpf.sql`

| # | o quê | por quê |
|---|---|---|
| 1 | `fn_cpf_normalizado(text)` — `IMMUTABLE`, reduz a dígitos | máscara não pode ser rota de fuga |
| 2 | limpeza guardada da duplicata existente | ver § 3.2 |
| 3 | **índice único parcial** `servidores_cpf_unico` sobre o CPF normalizado | o backstop real: sobrevive a deploy sem a checagem, a `INSERT` no SQL editor e à RLS |
| 4 | `fn_cpf_ja_cadastrado(cpf, ignorar_id)` — **`SECURITY DEFINER`** | enxerga a tabela inteira, que é o ponto |
| 5 | `fn_possiveis_duplicidades_servidor()` | cobre quem **não tem** CPF (§ 3.3) |
| 6 | `fn_cpf_digito_valido(text)` | um CPF com dígito errado escapa do índice único |

**O índice é parcial** (`WHERE ... IS NOT NULL`) porque **57 dos 184 servidores (31%) não têm CPF**,
e no Postgres `NULL` nunca conflita com `NULL` — um `UNIQUE` cheio não protegeria esses de qualquer
forma. Tornar o CPF obrigatório agora travaria a edição de um terço da base; a decisão fica para
depois do saneamento.

**Não há `CHECK` de dígito verificador.** Quatro CPFs em produção reprovam — HUGO MARCELO OSORIO,
MICHELLE RAIANNE MORAIS DA SILVA, FRANCISCA ASSIS ALMEIDA SANTOS e LUCILIA LIMA AZEVEDO. Um `CHECK`
abortaria a migration ou travaria a edição dessas quatro pessoas. A validação entra como **aviso**
no formulário.

### 3.2 A limpeza, e por que ela não é "fica o mais antigo"

A regra da migration: entre cadastros com o mesmo CPF, **fica o que tem histórico** e saem os que
não têm **nenhuma** referência. Se dois tiverem histórico, a migration **aborta** — fundir registro
de ponto de duas identidades é decisão de quem responde pela folha, não efeito colateral de
migration.

Isso importa porque neste caso a intuição erraria:

| cadastro | criado | setor | escala_mensal | marcacoes_ponto | folha_ponto | **total** |
|---|---|---|---|---|---|---|
| **A** — T2600019 | **05/08** (mais antigo) | ALMOXARIFADO | 0 | 0 | 0 | **0** |
| **B** — T2600014 | 07/08 (mais novo) | **CAF** | 1 (08/2026) | 10 | 1 | **12** |

**Apagar o mais antigo é o certo aqui; apagar o mais novo levaria junto 10 batidas reais de ponto.**

✅ **Confirmado pelo usuário em 09/08/2026:** a servidora é lotada na **CAF**, e o cadastro do
ALMOXARIFADO é o errado — ela nem está na escala de lá. A regra por histórico e o conhecimento do
domínio convergiram no mesmo cadastro. Isso valida a regra, não só o caso: **quem tem escala,
marcação e folha é quem de fato trabalha ali.**

As tabelas referenciadoras são descobertas em `pg_constraint`, não listadas à mão — uma FK criada
depois desta migration passa a ser considerada automaticamente.

**Simulação contra a produção antes de aplicar:** varri as 39 tabelas expostas e todas as colunas
que referenciam servidor. `A = 0` referências, `B = 12`. A migration mantém B e remove A, sem perda
de dado.

### 3.3 O que o índice único **não** resolve

Os 57 sem CPF continuam desprotegidos, e não há como resolver isso por constraint sem inventar
identidade. `fn_possiveis_duplicidades_servidor()` torna o problema **visível** — agrupa por CPF,
nome normalizado (sem acento, espaço colapsado), telefone e e-mail — em vez de deixá-lo implícito.
Diagnóstico, não bloqueio.

### 3.4 Código

- `verificarCpfDuplicado()` em [servidores/actions.ts](<../../src/app/(dashboard)/servidores/actions.ts>) —
  chama a RPC `SECURITY DEFINER`. Falha de rede **não** trava o cadastro: o índice único segura.
- Aplicada em `createServidor` e em `updateServidor` (com `p_ignorar_id`). O caso do update importa:
  preencher o CPF de um cadastro antigo é justamente quando a colisão aparece.
- `importServidores` ganhou **duas** conferências — dentro do próprio CSV (o arquivo pode repetir a
  pessoa) e contra o banco. Cancela o arquivo inteiro apontando **a linha**, em vez de estourar na
  constraint com uma mensagem que não diz qual registro causou.
- `traduzirErroMatricula` → `traduzirErroCadastro`, agora traduzindo também o `23505` do CPF.

---

## 4. Correção acoplada: configuração de comunicação da unidade

Encontrado no mesmo caminho. [unidades/actions.ts](<../../src/app/(dashboard)/unidades/actions.ts>)
gravava a configuração em **dois** lugares:

```ts
try {
  await supabase.from('unidades').update({ configuracoes_comunicacao: parsedConfig }).eq('id', id)
} catch (errCol) { /* Ignora silenciosamente caso a coluna ainda não exista */ }
```

A coluna `unidades.configuracoes_comunicacao` **não existe em produção** — conferido por sonda:
`column unidades.configuracoes_comunicacao does not exist`.

Pior que ser inútil, era **invisível duas vezes**: o `try/catch` não pegava nada (o supabase-js
devolve `{ error }`, não lança) e o `catch` externo só cobria o `JSON.parse`. A tela sempre reportou
sucesso.

Corrigido: **fonte única em `configuracoes_globais`**, chave `unidade_comunicacao_<id>` — que é de
onde `sendWhatsAppMessageAction` já lê e a única via que sempre funcionou. O erro do upsert agora
**aparece na tela**. O fallback morto foi removido também de `unidades/[id]/page.tsx`.

Junto: `sharePinWhatsApp` passou a mandar `unidadeId` nas duas telas de servidor — sem ele, o PIN
saía sempre pelo canal global, mesmo em unidade com canal próprio.

---

## 5. Verificação

`npx tsc --noEmit` limpo. As consultas de conferência estão no rodapé da migration:

1. nenhum CPF duplicado;
2. sobrou exatamente 1 linha para `06307223235`, matrícula `T2600014`;
3. o índice `servidores_cpf_unico` existe;
4. o que resta de suspeita (esperado: grupos de quem não tem CPF);
5. os 4 CPFs com dígito inválido, para correção no cadastro.

⚠️ Aplicar em **homologação primeiro**. A seção 2 da migration faz `DELETE`.

---

## 6. Fica pendente

1. **Corrigir os 4 CPFs com dígito inválido** — enquanto existirem, um deles pode ser o CPF de
   outra pessoa digitado errado.
2. **Preencher os 57 CPFs faltantes** — é o que fecha a última porta de duplicação, e casa com o
   projeto de qualidade de dados da Fase 9 do módulo REP (`pis_pasep` está vazio em **100%** da
   base, e auditor fiscal casa por PIS/NIS).
3. **Tela de duplicidades** consumindo `fn_possiveis_duplicidades_servidor()` — hoje a função
   existe e ninguém a chama.
4. **Tornar o CPF obrigatório** no cadastro, depois de 1 e 2.
