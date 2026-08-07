# SisEscala — guia para agentes

Sistema de gestão de escalas e ponto digital da **Secretaria Municipal de Saúde de Marabá (DMAC)**.
**Está em produção com dados reais de servidores públicos.** Erros aqui viram folha de ponto errada
e problema jurídico. Prefira investigar demais a supor de menos.

Ver também [`.agents/AGENTS.md`](.agents/AGENTS.md) — regras que **complementam** este arquivo.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + RLS + Auth) · Vercel
Sem framework de testes. `npm run build` e `npx tsc --noEmit` são a única verificação automática.

```
src/app/(dashboard)/     telas internas (escalas, folha-ponto, relatórios, cadastros)
src/app/consultar-escala portal do servidor (login por matrícula + PIN)
src/app/presenca         terminal de ponto
supabase/migrations/     60+ migrations SQL
docs/                    planos, evolução por versão, diagnósticos
```

## Onde mora a complexidade

**Não é no frontend.** A lógica crítica está em funções PL/pgSQL grandes:

| função | papel |
|---|---|
| `fn_confirmar_presenca` | ~1.030 linhas. Decide, a cada batida no terminal, **qual** dos 4 passos está sendo registrado (entrada → saída intervalo → retorno intervalo → saída), com janela de tolerância, blocos contíguos e turnos que cruzam a meia-noite. |
| `fn_confirmar_presenca_manual` | Validação manual pelo coordenador. Grava horários **sintéticos** derivados da jornada. |
| `fn_confirmar_presenca_manual_bulk` | Apenas um laço que **delega** para `fn_confirmar_presenca_manual`. Corrigir a função manual corrige a validação em massa junto. |
| `fn_jornada_tem_intervalo` | Fonte única da regra de intervalo intrajornada (CLT Art. 71). |

`ScaleGrid.tsx` (~5.000 linhas) é a grade de escala — o maior arquivo do frontend.

## Armadilhas conhecidas

### 1. `CREATE OR REPLACE` já apagou lógica crítica duas vezes

As funções de presença são recriadas inteiras a cada migration. **Duas regressões reais** já
aconteceram por omitir um trecho ao recopiar:

- 04/08/2026 — perda do alinhamento dinâmico de hora extra (documentado em `.agents/AGENTS.md`).
- `20260804080000` — perda do guard de intervalo, corrigido em `20260806000000`.

**Antes de alterar `fn_confirmar_presenca*`:**

1. Descubra qual migration define a versão **vigente** — não é necessariamente a que o nome sugere.
   `grep -rln "FUNCTION public.fn_confirmar_presenca" supabase/migrations/ | sort | tail -1`
2. Gere a nova migration **copiando o arquivo vigente** e aplicando substituições pontuais por script,
   depois confira com `diff`. Não redigite o corpo à mão.
3. Confirme que os guards existentes continuam presentes no resultado.

### 2. As migrations não são o schema completo

Tabelas base (`escala_diaria`, `escala_mensal`, `jornadas`, `dicionario_turnos`, `servidores`,
`unidades`, `setores`) foram criadas **fora do versionamento** e só existem no banco.
`src/types/database.ts` também está incompleto — não contém `escala_diaria` nem `jornadas`.

**Não confie nos arquivos para saber a forma das tabelas. Consulte o banco.**

### 3. Dois bancos diferentes

| ambiente | URL | acesso |
|---|---|---|
| homologação | `.env.local` → `mtgfmxsbsyknotvwzdcr.supabase.co` | REST |
| **produção** | `.env.production` → `supabase-sisescala.coolify.vps.atb.app.br` | REST (porta 5432 bloqueada por firewall) |

Os schemas **divergem** (ex: em 06/08/2026, `escala_diaria` de homologação não tinha
`justificativa_manual` / `confirmacao_manual`, que as funções escrevem). Sempre confirme
em qual banco você está antes de concluir qualquer coisa sobre os dados.

Só há `DATABASE_URL` em produção, e a porta Postgres não é acessível de fora — na prática,
consultas são feitas via PostgREST com a service role key. **Peça autorização antes de tocar
em produção, mesmo para leitura.**

### 4. Horários vêm de regex sobre o nome da jornada

Não existe coluna `start_hour`. A hora de início/fim é extraída do **nome**:

```sql
substring(j.nome from '^([0-9]+)')                    -- "08H ÀS 12H" → 8
substring(j.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')   -- "08H ÀS 12H" → 12
```

**Renomear uma jornada quebra o cálculo de presença.** O mesmo parsing está duplicado no
frontend (`ScaleGrid.tsx`) — mudanças precisam ser feitas nos dois lados.

### 5. Horário sintético vs. batida real

Timestamps redondos (`:00:00`) são gerados por validação manual. Batidas reais de terminal têm
segundos e microssegundos. Ao auditar dados de ponto, **essa distinção decide se um registro pode
ser movido ou precisa ser refeito** — mover um horário sintético para outro campo fabrica um
registro de ponto falso.

### 6. Fusão de blocos: Sobreaviso nunca funde

`fn_confirmar_presenca` agrupa os turnos do dia em **blocos contínuos**: se um turno começa
antes ou no instante em que o anterior termina (`v_s2_inicio <= v_s1_fim`), viram um bloco só,
e a janela de **saída** passa a ser o fim do último turno.

Isso é **correto e desejado** para `Regular` + `Extra` + `Plantão` — ex.: 08h–18h + 2h extra +
Plantão N 12h formam um bloco único, com saída esperada no fim do plantão.

**Sobreaviso não entra nessa conta.** Não é trabalho presencial, não marca presença e tem ciclo
próprio em `logs_sobreaviso`. Agrava o fato de que o `start_hour` do Sobreaviso é alinhado ao fim
do turno Regular (o 3º elemento do `COALESCE` de `start_hour` **não filtra por categoria**), então
um Sobreaviso N12 encosta exatamente no fim da jornada e fundia com ela.

Sintoma quando quebra: servidor não consegue bater a saída, e `logs_tentativas_presenca` mostra
`escala_prevista_fim` com o horário do sobreaviso em vez do fim do turno.

**Sobreaviso não marca presença, ponto.** Ciclo próprio em `logs_sobreaviso`: acionamento →
aceite (magic link por WhatsApp/e-mail/SMS) → chegada (GPS ou validação manual). Nada disso
entra na folha de ponto, que lê só `Regular` e `Extra`. Em 522 acionamentos de produção,
**zero** usaram o terminal (514 Manual, 8 GPS).

Três camadas de defesa, todas devem ser preservadas:

| camada | onde | migration |
|---|---|---|
| guards `<> 'Sobreaviso'` nas 8 fusões de bloco | `fn_confirmar_presenca` | `20260807000000` |
| `Sobreaviso` fora da lista de categorias dos blocos + função manual não escreve em `escala_diaria` | ambas as funções | `20260807020000` |
| `CHECK chk_sobreaviso_sem_presenca` | tabela `escala_diaria` | `20260807030000` |

A constraint é a única que sobrevive a um `CREATE OR REPLACE` descuidado — é ela que torna a
regra realmente definitiva.

⚠️ As checagens de **acesso** do coordenador (as que não têm `ORDER BY start_hour`) continuam
aceitando `Sobreaviso` de propósito: sem isso, quem tem só sobreaviso no dia perderia acesso
ao terminal.

### 7. Batidas recusadas ficam registradas

`logs_tentativas_presenca` guarda toda tentativa negada, com `data_hora_tentativa`,
`mensagem_erro` e `escala_prevista_inicio`/`fim`. É a **fonte de verdade** para recuperar
horários reais quando uma batida legítima foi recusada por bug — muito melhor que presumir
horário a partir da jornada. Ver `20260807010000` como exemplo, e `fn_reconciliar_presencas_negadas`.

### 8. PostgREST corta em 1000 linhas

Consultas via REST retornam no máximo 1000 registros, **silenciosamente** — `limit=2000` não
adianta. `escala_diaria` tem ~3.500 linhas só em 08/2026. Sem paginação por header `Range`,
auditorias dão resultado errado e parecem corretas. Já causou dois diagnósticos falsos.

```js
for (let from = 0; ; from += 1000) {
  const r = await fetch(url, { headers: { ...H, Range: `${from}-${from + 999}` } })
  const page = await r.json(); out.push(...page)
  if (page.length < 1000) break
}
```

### 9. Regra de intervalo intrajornada (CLT Art. 71)

Intervalo só para jornadas **acima de 6h**. Fonte única:

```sql
public.fn_jornada_tem_intervalo(p_duracao_minutos, p_intervalo_minutos)
  -- duração > 360 min E intervalo_minutos > 0
```

**Modo do intervalo** — três níveis, do mais geral ao mais específico:

1. `unidades.tipo_intervalo` = `flexivel` | `rigido`
2. `servidores.intervalo_inicio/fim_personalizado` — exceção de **horário** dentro do modo rígido
3. `servidores.intervalo_flexivel` (bool) — libera horário livre **mesmo em unidade rígida**

Com `intervalo_flexivel = true`, os campos personalizados deixam de ser horário obrigatório e
passam a definir só a **duração prevista**. A saída vira dinâmica:

```
saída_esperada = fim previsto + (intervalo real − intervalo previsto)
```

Excedente adia, déficit antecipa (mantém a carga líquida). Sem nenhuma marcação de intervalo,
a saída fica no horário previsto. Implementado em `20260807050000` via
`fn_ajuste_intervalo_flexivel`; os passos 2 e 3 do terminal ganham ramos próprios para o modo
flexível. **Preserve-os ao recriar a função.**

Vale para **todas** as categorias, inclusive Plantão. No cadastro atual, toda jornada ≤ 6h tem
`intervalo_minutos = 0`. A duração vem de `horas_totais` (Regular) ou `horas_computadas` do turno
(Plantão/Extra). `ScaleGrid.tsx` espelha essa regra para escolher entre 2 e 4 segmentos — se alterar
uma ponta, altere a outra.

## Convenções

- **Idioma:** identificadores de domínio, comentários e mensagens de usuário em português.
  Migrations SQL sem acentos nos comentários.
- **Migrations:** `YYYYMMDDHHMMSS_descricao_em_ingles.sql`. Arquivos usam **CRLF** — scripts que
  fazem substituição de texto precisam tratar isso.
- **Nunca** rode migration direto em produção sem validar em homologação antes.
- Timezone padrão: `configuracoes_globais.timezone`, fallback `America/Sao_Paulo`.

## Verificação

```bash
npx tsc --noEmit     # type-check
npm run build        # build de produção
npm run lint
```

Não há testes automatizados. Mudanças em lógica de presença exigem verificação manual na grade
e no terminal, além da consulta de conferência incluída em cada migration de dados.
