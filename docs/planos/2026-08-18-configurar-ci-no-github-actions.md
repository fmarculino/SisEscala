# Configurar CI no GitHub Actions (17/08/2026 — para execução em 18/08/2026)

**Contexto:** o SisFrota (projeto irmão) nasceu com CI desde o dia 1. Ao comparar com o
SisEscala, ficou claro que aqui nunca existiu — nem ESLint chegou a ser configurado
(`next lint` cai direto no assistente interativo de primeira configuração, sinal de que
nunca rodou). Como o SisEscala já está em produção com dado real de servidor (folha de
ponto), um bug que passa batido tem custo imediato — então vale mais a pena aqui do que
no SisFrota, mesmo sendo mais trabalhoso de configurar.

## Diagnóstico (medido em 17/08/2026, numa cópia isolada — nada foi alterado no repositório)

- **TypeScript: limpo.** `npx tsc --noEmit` roda sem nenhum erro em 192 arquivos
  (`src/**/*.ts(x)`). O `tsc --noEmit` do CI pode entrar como obrigatório desde o primeiro
  dia, sem fricção.
- **ESLint: nunca configurado, e ao ligar aparecem 1.070 problemas** (841 erros, 229
  avisos) em 131 dos 196 arquivos `.ts`/`.tsx`. Detalhe importante: **90% dos erros (755
  de 841) são uma única regra repetida**, `@typescript-eslint/no-explicit-any` — não são
  755 bugs diferentes, é um hábito de usar `any` nunca proibido.

  Distribuição completa:

  | Regra | Ocorrências |
  |---|---|
  | `@typescript-eslint/no-explicit-any` | 755 |
  | `@typescript-eslint/no-unused-vars` | 168 |
  | `react/no-unescaped-entities` | 62 |
  | `react-hooks/exhaustive-deps` | 36 |
  | `prefer-const` | 21 |
  | `@next/next/no-img-element` | 18 |
  | `jsx-a11y/alt-text` | 2 |
  | `react-hooks/rules-of-hooks` | 2 |
  | `@typescript-eslint/no-require-imports` | 1 |

  15 erros e 5 avisos são corrigíveis automaticamente com `eslint --fix`.

## Plano — em duas etapas, para não travar ninguém amanhã

**Etapa 1 (18/08, curta):** configurar ESLint de verdade (`eslint.config.mjs`, igual ao
que já existe no SisFrota), mas com `@typescript-eslint/no-explicit-any` rebaixado para
`warn` em vez de `error` — assim o lint roda e o CI pode ficar obrigatório (`lint` +
`typecheck` + `build`) sem bloquear ninguém pelos 755 casos já existentes. As outras
regras (unused-vars, unescaped-entities, prefer-const, no-img-element) entram como
`error` desde já — são poucas (168 no pior caso) e dá pra corrigir de uma vez com
`eslint --fix` + revisão manual do resto no mesmo PR que liga o CI.

**Etapa 2 (depois, sem pressa):** ir promovendo `no-explicit-any` de `warn` para `error`
por pasta ou por PR, à medida que cada `any` for tipado — sem exigir um esforço
concentrado de "tipar os 755 de uma vez".

## Por que não travar tudo de uma vez

755 erros de uma regra só, todos de uma vez, é ruído — ninguém revisa 755 mudanças de
tipo com atenção real, e vira commit de "corrigir lint" gigante e arriscado. Ativar CI
obrigatório com a regra em `warn` dá o trilho (lint sempre roda, ninguém finge que não
existe) sem forçar uma reescrita perigosa de uma vez.

## Referência

Workflow usado como modelo no SisFrota: `.github/workflows/ci.yml`
(`github.com/fmarculino/sisfrota`) — `checkout` → `setup-node` (Node 22) → `npm ci` →
`lint` → `tsc --noEmit` → `build`, em push e PR para `main`.
