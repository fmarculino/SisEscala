# Relógio REP compartilhado por múltiplos setores da mesma unidade

**Data:** 13/08/2026
**Origem:** pergunta do usuário revisando o modal "Editar dispositivo REP" do relógio da LACEM —
hoje só a Informática bate ali, mas Regulação vai passar a usar o mesmo relógio, e TFD (ainda nem
cadastrado) e outros setores da unidade devem seguir. Cada um com escala própria.
**Estado:** ✅ aplicado e verificado em produção (13/08/2026).
**Revisado em:** 13/08/2026, a pedido do usuário — "algumas unidades e setores já estão usando o
ponto, não podemos correr o risco de quebrar o sistema". Ver seção de impacto logo abaixo.

## Implementação (13/08/2026)

| peça | onde |
|---|---|
| schema aditiva (tabela + backfill + RLS) | `supabase/migrations/20260813130000_add_dispositivos_rep_setores.sql` |
| funções reescritas + nova RPC | `supabase/migrations/20260813140000_multi_setor_dispositivos_rep.sql`, gerada por `scratchpad/gen_multi_setor_dispositivo.js` (cópia mecânica do corpo vigente, com conferência de invariantes e reconstrução byte a byte antes/depois — CLAUDE.md armadilha 1) |
| `actions.ts` (`marcacoes`) | `setor_id` único → `setor_ids: string[]`; grava via `fn_definir_setores_dispositivo_rep` numa sessão de usuário (não admin client), preservando `criado_por_id` |
| `DispositivoRepModal.tsx` | checkboxes de setor + "Toda a unidade" no lugar do `<select>` único |
| `CoberturaTab.tsx` / `MarcacoesClient.tsx` | `setor_nome` → `setores_nomes` (lista) |

`npx tsc --noEmit` e `npm run build` passaram limpos. Bug real pego na revisão manual do
primeiro arquivo gerado pelo script (não pelas checagens automáticas): a resolução de
`fn_cobertura_ponto_dispositivo` continuava fazendo `SELECT d.unidade_id, d.setor_id INTO
v_unidade_id, v_setor_id` depois de `v_setor_id` já ter sido removida do `DECLARE` — teria
quebrado a função no primeiro uso. Corrigido no gerador, que ganhou checagem extra
(`v_setor_id` não pode sobrar em lugar nenhum do corpo final) para não deixar essa classe de erro
passar de novo.

## Verificação em produção (13/08/2026)

Aplicado direto em produção pelo usuário (sem acesso a homologação nesta sessão). Checkpoints 1 e
2 reproduziram os dois dispositivos reais corretamente — inclusive um caso não previsto nos
comentários da migration: o dispositivo da TI já tinha `setor_id` preenchido (não só "toda a
unidade"), e o backfill/agregação tratou esse caso certo também.

⚠️ **Bug real achado no checkpoint 4, só em produção:** `fn_ingerir_afd` usava
`SELECT count(*), min(setor_id) INTO ...` — **Postgres não tem agregado `min()`/`max()` para
`uuid`** (o tipo suporta `<`/`>`/`ORDER BY`, mas não tem operator class de agregação registrada).
Isso quebrava toda sincronização de AFD (LACEM e TI) desde a aplicação da migration até a
correção. Nenhum dos testes anteriores (tsc, build, reconstrução byte a byte do script gerador)
pegou isso — só apareceu ao rodar a consulta equivalente contra dados reais. Corrigido trocando a
agregação por duas consultas (`count(*)` e, só se igual a 1, um segundo `SELECT` do valor); o
gerador (`scratchpad/gen_multi_setor_dispositivo.js`) ganhou checagem para essa classe de erro não
voltar. Reaplicado e confirmado (`pg_get_functiondef` sem o padrão do bug; `rep_sincronizacoes`
mostrando syncs reais concluídos com sucesso depois da correção).

Checkpoint 3 (`fn_definir_setores_dispositivo_rep`) rodado contra o dispositivo de teste
(`REP-TESTE-TI`), nunca contra LACEM/TI reais: gravação de setores ok, recusa de setor de outra
unidade ok (sem gravar nada), limpeza final ok.

**Lição para a próxima migration que mexer em coluna `uuid` com `min()`/`max()`/`SUM` genérico:**
conferir se o tipo tem o agregado antes de assumir — funciona para a maioria dos tipos base do
Postgres, mas não para `uuid`.

---

## Revisão de impacto em produção — escalas, folha de ponto e o resto do sistema

Antes de tocar em qualquer coisa, segui a cadeia completa: **de onde vem o dado que forma a folha
de ponto hoje, e em algum ponto dela `dispositivos_rep.setor_id` entra?** Rastreei os quatro
lugares que poderiam ser afetados.

### 1. Escalas (`escala_mensal`/`escala_diaria`) — só leitura, sem risco

As três funções que leem `d.setor_id` (`fn_enfileirar_cadastros_rep`, `fn_cobertura_ponto_dispositivo`,
`fn_enfileirar_cadastros_por_escala`) **leem** `escala_mensal`/`escala_diaria`, nunca escrevem.
Trocar a condição de filtro não altera uma linha de escala. Risco: nenhum.

### 2. Folha de ponto — o caminho que gera a folha hoje **não passa pelo relógio**

Este é o achado que muda a avaliação de risco. Segui os dois caminhos possíveis de "batida vira
folha":

- **Caminho clássico (o que está em produção para todo mundo hoje):**
  `fn_confirmar_presenca`/`fn_confirmar_presenca_manual` escrevem direto em
  `escala_diaria.presenca_*`. Nenhuma das duas referencia `dispositivos_rep` — busquei no corpo
  das duas e não há menção. Um trigger (`fn_sincronizar_marcacoes_escala_diaria`,
  `20260808070000`) espelha essa escrita em `marcacoes_ponto`, mas o `unidade_id`/`setor_id` que
  ele grava vem de `escala_mensal` (a lotação real do servidor naquele mês), **não** do
  dispositivo. Este caminho é 100% imune a qualquer coisa que eu mude em `dispositivos_rep`.

- **Caminho do relógio (o que a Fase 4-7b construiu):** `fn_ingerir_afd` cria
  `rep_afd_registros` + `marcacoes_ponto` (origem `rep`) a partir do AFD. **Isto não escreve em
  `escala_diaria`.** Quem faria essa ponte é a reconciliação da Fase 5
  (`fn_reconciliar_marcacoes_dia`/`fn_alocar_marcacoes_dia`, `20260808050000`/`20260808060000`) —
  e **busquei em todo `src/` por uma chamada a qualquer uma das duas: não existe nenhuma.** Não é
  rota de API, não é cron, não é trigger. As únicas execuções registradas nas migrations são
  consultas manuais de conferência (`fn_conferir_reconciliacao`), rodadas à mão pelo desenvolvedor.
  **A Fase 5 nunca foi ligada.** É consistente com o CLAUDE.md: a seção "Pendências que bloqueiam
  a Fase 5" ainda lista item aberto (as três regras de intervalo só convergem na Fase 8).

  Conclusão: hoje, em **nenhuma unidade**, uma batida do relógio vira linha de folha de ponto
  sozinha. LACEM incluída — os 39 servidores escalados lá continuam tendo a folha alimentada pelo
  terminal clássico ou validação manual, exatamente como qualquer outra unidade. O relógio está
  gravando `rep_afd_registros`/`marcacoes_ponto` em paralelo, como observação, não como fonte da
  folha.

**Isso muda o que este plano precisa proteger.** Mexer em `dispositivos_rep.setor_id` não pode
quebrar a folha de ponto de ninguém agora porque a folha, hoje, não lê esse campo nem por caminho
direto nem indireto — o único fio que ligaria os dois (Fase 5) está desconectado.

### 3. `marcacoes_ponto.setor_id` (o que `fn_ingerir_afd` grava a partir do dispositivo) — campo sem nenhum consumidor hoje

Fui atrás de quem lê essa coluna especificamente para batidas de origem `rep`:

| consumidor candidato | usa `marcacoes_ponto.setor_id`? |
|---|---|
| RLS de leitura de `marcacoes_ponto` (`20260808010000`) | não — só `fn_unidade_no_escopo(unidade_id)` |
| `fn_alocar_marcacoes_dia` (o casamento batida↔passo) | não — filtra só por `servidor_id` + `origem` + janela de tempo |
| `fn_marcacoes_pendentes_revisao` (aba "Pendências" do módulo) | recebe a coluna, mas a query **exclui explicitamente `origem = 'rep'`** (`WHERE m.origem IN ('terminal', 'ajuste_servidor')`) — nunca vê o valor que viria do dispositivo |
| `ScaleGrid.tsx`, `folha-ponto/actions.ts`, `PendenciasTab.tsx` | nenhum select em `marcacoes_ponto` no frontend pede a coluna `setor_id` |

Ou seja: o valor que `fn_ingerir_afd` grava em `marcacoes_ponto.setor_id` a partir de
`dispositivos_rep.setor_id` **não é lido por nada hoje**. Isso simplifica a Fase 2 do plano: não
preciso ensinar `fn_ingerir_afd` a resolver o setor "certo" por servidor (o que exigiria uma
consulta a mais por linha de AFD, no maior volume de escrita do módulo — CLAUDE.md já registra
~36 mil linhas reprocessadas por ciclo na LACEM). Basta gravar `NULL` quando o dispositivo tiver
mais de um setor associado, do mesmo jeito que já grava `NULL` hoje para "toda a unidade" — sem
mudança de comportamento observável, porque nada observa esse valor.

⚠️ **Pendência que registro para o futuro, não para agora:** no dia em que a Fase 5 for ligada de
verdade, alguém vai precisar decidir como resolver `setor_id` de uma batida de relógio
multi-setor — provavelmente espelhando o que o trigger já faz hoje (ler da `escala_mensal` do
servidor, não do dispositivo). Não é decisão para tomar neste plano; é só para não se perder.

### 4. RLS de `dispositivos_rep` — não depende de `setor_id`

A policy de leitura (`"Leitura de dispositivos por escopo"`, `20260808010000`) usa só
`fn_unidade_no_escopo(unidade_id)`. Trocar `setor_id` por uma tabela de junção não muda quem
enxerga a linha do dispositivo na tela.

### Onde o risco real está — e onde ele não chega

O impacto verdadeiro fica **inteiramente dentro do módulo REP em construção** (Fase 4-7b), hoje
usado só pelo piloto da TI (6 pessoas) e pelo rollout que está começando na LACEM:

| muda | não muda |
|---|---|
| `fn_enfileirar_cadastros_rep`, `fn_enfileirar_cadastros_por_escala` (fila de cadastro) | `fn_confirmar_presenca`, `fn_confirmar_presenca_manual`, `fn_confirmar_presenca_manual_bulk` |
| `fn_cobertura_ponto_dispositivo`, `fn_cobertura_ponto_resumo` (aba Cobertura, só leitura/diagnóstico) | `fn_blocos_previstos_dia`/`_mes`, `fn_reconciliar_marcacoes_dia` (não chamada por ninguém) |
| `fn_ingerir_afd` — só o valor gravado em `marcacoes_ponto.setor_id`, campo sem consumidor | `ScaleGrid.tsx`, grade de escala, terminal clássico `/presenca`, Portal do servidor |
| `actions.ts`/`DispositivoRepModal.tsx` do módulo `/marcacoes` | `folha-ponto/actions.ts`, geração de folha, PDF |
| RLS de `dispositivos_rep`, `rep_sincronizacoes`, `rep_afd_registros`, `rep_vinculos_servidor` (já filtram só por `unidade_id`) | nenhuma RLS de `escala_diaria`/`escala_mensal`/`folha_ponto` |

E, mesmo dentro do módulo REP: **a ingestão do AFD continua funcionando durante e depois da
migration**, porque `fn_ingerir_afd` não é uma das funções reescritas por completo — só o valor
que ela passa para `setor_id` muda de "olhar uma coluna" para "olhar se há 0 ou 1 setor na
junção". Se a tela de Cobertura ou o botão "Sincronizar cadastros" ficarem temporariamente quebrados
por um erro de deploy, a pior consequência é a tela mostrar erro — nenhuma batida deixa de ser
gravada, porque a gravação (`rep_afd_registros`/`marcacoes_ponto`) não depende dessas funções.

---

## O problema

`dispositivos_rep.setor_id` é uma FK **única e opcional** para `setores`
(`20260808000000_create_marcacoes_ponto_model.sql`, coluna `setor_id uuid NULL`). O modal só
oferece dois estados por relógio:

| `setor_id` | significa | tela |
|---|---|---|
| `NULL` | serve **toda a unidade** | "Toda a unidade" |
| preenchido | serve **um** setor só | nome do setor |

Não existe meio-termo: "estes N setores desta unidade, não os outros M". É exatamente o caso que
está se formando na LACEM — Informática, Regulação e (em breve) TFD dividindo o mesmo relógio
físico, dentro da mesma unidade, cada um com escala e coordenação próprias.

Esse `setor_id` não é só rótulo de tela. Três funções o leem para decidir **quem é candidato a
usar aquele relógio**:

| função | o que faz com `d.setor_id` |
|---|---|
| `fn_enfileirar_cadastros_rep` (botão "Sincronizar cadastros", Fase 7) | filtra candidatos por lotação: `s.unidade_id = v_unidade_id AND (v_setor_id IS NULL OR s.setor_id = v_setor_id)` |
| `fn_cobertura_ponto_dispositivo` (aba Cobertura da Escala) | filtra quem está escalado: `em.unidade_id = v_unidade_id AND (v_setor_id IS NULL OR em.setor_id = v_setor_id)`, e usa a mesma condição para `lotacao_compativel` |
| `fn_cobertura_ponto_resumo` | só faz `LEFT JOIN setores se ON se.id = d.setor_id` para exibir o nome — herda a limitação de exibição |
| `fn_enfileirar_cadastros_por_escala` (13/08) | não lê `setor_id` diretamente, mas herda o filtro por estar em cima de `fn_cobertura_ponto_dispositivo` |

Com `setor_id = Regulação`, a Informática nunca aparece como candidata a cadastro nem a cobertura
naquele relógio — mesmo já batendo ponto ali fisicamente. Com `setor_id = NULL` ("toda a
unidade"), TFD entraria automaticamente **mesmo se nunca for usar aquele relógio**, poluindo a
aba Cobertura com gente que nunca vai bater ali. Nenhuma das duas opções descreve "Informática +
Regulação + TFD, e mais ninguém".

## Por que não dá para contornar sem mexer no schema

A saída aparentemente mais simples — cadastrar um `dispositivos_rep` por setor, todos apontando
para o mesmo IP/número de série — não funciona:

1. `uq_dispositivo_serie UNIQUE (fabricante, numero_serie)` recusa o segundo registro com o mesmo
   número de série.
2. Mesmo sem a constraint, o coletor e o ciclo de sincronização são por `dispositivo_id`: dois
   registros para o mesmo relógio físico teriam `ultimo_nsr`, token e histórico de AFD
   **independentes** — cada ciclo de 5 min duplicaria a leitura do mesmo AFD contra o mesmo
   relógio (a idempotência de `fn_ingerir_afd` absorve o dado, mas dobra tráfego, log e
   diagnóstico sem necessidade).
3. `rep_vinculos_servidor`, `rep_afd_registros`, `rep_usuarios_dispositivo` e `marcacoes_ponto`
   são todas chaveadas por `dispositivo_id`. Duplicar o dispositivo fragmentaria o vínculo do
   mesmo servidor entre dois registros "iguais" sem nenhum ganho real.

O modelo correto continua **um `dispositivos_rep` por relógio físico**. O que falta é uma forma
de listar N setores por relógio em vez de 0 ou 1.

## Solução: tabela de junção dispositivo ↔ setor

```sql
CREATE TABLE public.dispositivos_rep_setores (
    dispositivo_id uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    setor_id       uuid NOT NULL REFERENCES public.setores(id),
    PRIMARY KEY (dispositivo_id, setor_id)
);
```

Semântica, espelhando exatamente o que `setor_id IS NULL` já significa hoje:

| linhas na junção | significa |
|---|---|
| **0** | "toda a unidade" — comportamento idêntico ao `setor_id NULL` atual |
| **≥ 1** | só os setores listados |

Toda condição hoje escrita como `(v_setor_id IS NULL OR X.setor_id = v_setor_id)` vira
`(NOT EXISTS junção-para-este-dispositivo OR EXISTS junção-casando-com-X.setor_id)` — mesma forma,
mesma leitura, só troca "um setor ou nenhum" por "um conjunto ou nenhum".

## O que muda em cada camada

| camada | mudança |
|---|---|
| schema | nova tabela `dispositivos_rep_setores` + backfill: para todo `dispositivos_rep` com `setor_id IS NOT NULL` hoje, insere uma linha correspondente |
| `fn_enfileirar_cadastros_rep` | troca a condição de `s.setor_id` para a junção |
| `fn_cobertura_ponto_dispositivo` | idem para `em.setor_id` (escalados) e para `lotacao_compativel` |
| `fn_cobertura_ponto_resumo` | `setor_nome` (uma coluna) vira algo como `setores_nomes text[]` ou uma contagem — não há mais "o" setor de um relógio |
| `fn_enfileirar_cadastros_por_escala` | nada a mudar — herda via `fn_cobertura_ponto_dispositivo` |
| `actions.ts` (`lerCamposDispositivo`, `criarDispositivoRep`, `atualizarDispositivoRep`, `listarDispositivosRep`) | `setor_id: string \| null` vira `setor_ids: string[]`; salvar passa a gravar na tabela de junção (via RPC dedicada, para manter a escrita atômica em vez de duas chamadas REST sequenciais do cliente) |
| `DispositivoRepModal.tsx` | o `<select>` único de Setor vira lista de checkboxes dos setores da unidade escolhida, com "Toda a unidade" como estado especial (nenhum marcado) |
| aba Cobertura da Escala | mostra "N setores" ou lista compacta em vez de um nome só, quando o relógio tiver mais de um |
| `dispositivos_rep.setor_id` (coluna antiga) | removida depois que os dois lados (funções + `actions.ts` + UI) já lerem só a junção — manter os dois em paralelo seria a mesma armadilha de dado duplicado que motivou rejeitar a saída de "um dispositivo por setor" |

## Sequência de migração sugerida

Dado que a folha de ponto não depende deste campo (seção de impacto acima), a sequência abaixo é
conservadora por opção, não por necessidade estrita — cada etapa é isoladamente reversível e
verificável antes de avançar para a próxima.

1. **Schema, sozinha, aditiva:** `CREATE TABLE dispositivos_rep_setores` + backfill a partir do
   `setor_id` atual + índice em `setor_id`. **Não altera nenhuma função existente** — `setor_id`
   continua sendo a coluna que tudo lê até a etapa 2. Reversível com `DROP TABLE` se algo parecer
   errado. Conferência: `SELECT count(*) FROM dispositivos_rep_setores` tem que bater com
   `SELECT count(*) FROM dispositivos_rep WHERE setor_id IS NOT NULL` (hoje, provavelmente 0 — nem
   TI nem LACEM usam "um setor só").
2. **Funções, numa segunda migration:** reescrever as três (`fn_enfileirar_cadastros_rep`,
   `fn_cobertura_ponto_dispositivo`, `fn_cobertura_ponto_resumo`) e ajustar a chamada dentro de
   `fn_ingerir_afd` (só a origem do `setor_id` passado a `fn_registrar_marcacao` — nada mais no
   corpo dela muda), geradas por script de cópia mecânica — padrão já usado no projeto
   (`gen_ancora.js`, `gen_guard_aceitar.js`) para não redigitar corpo de função à mão (CLAUDE.md,
   armadilha 1). `fn_cobertura_ponto_dispositivo`/`fn_cobertura_ponto_resumo` mudam o
   `RETURNS TABLE`, então precisam de `DROP FUNCTION IF EXISTS` antes do `CREATE` (armadilha já
   documentada na própria migration de 13/08 — `42P13` se pular o `DROP`). **Checkpoint
   obrigatório antes de seguir para a etapa 3:** rodar `fn_cobertura_ponto_resumo(8, 2026)` e
   conferir que os números da LACEM continuam 39/27/10/1/1 (ver seção de conferência abaixo). Se
   divergir, é regressão na tradução da condição — não avançar, corrigir aqui.
3. **`actions.ts`:** trocar campo único por lista; escrever via RPC nova
   (`fn_definir_setores_dispositivo_rep(dispositivo_id, setor_ids[])`) que substitui o conjunto
   inteiro numa transação, em vez de o cliente fazer delete+insert por conta própria.
4. **UI:** `DispositivoRepModal.tsx` com multi-seleção; aba Cobertura ajustada para exibir lista.
   Etapas 3 e 4 saem juntas (o formulário novo já espera a RPC nova).
5. **Só depois de rodar em produção por um tempo e confirmar que nada mais lê a coluna antiga:**
   migration separada derrubando `dispositivos_rep.setor_id`. Não tem pressa nenhuma para esta
   etapa — mantê-la por mais tempo não tem custo, porque nenhuma função da etapa 2 em diante volta
   a lê-la.

## Conferência obrigatória depois de aplicar

O relógio da LACEM está hoje em "toda a unidade" (`setor_id NULL`) — depois do backfill ele fica
com **0** linhas na junção, que é exatamente a mesma semântica. A migration de 13/08
(`20260813000000_add_cobertura_ponto_rep.sql`) já documentou os números de referência da LACEM
(39 escalados, 27 sem vínculo, 10 fora do relógio, 1 sem biometria, 1 ok) — rodar
`fn_cobertura_ponto_resumo(8, 2026)` de novo depois da mudança tem que reproduzir os mesmos
números. Se divergir, a regressão está na tradução da condição, não no dado.

## O que NÃO muda

- `dispositivos_rep.unidade_id` continua único por dispositivo — nenhum caso relatado (nem
  conhecido) de um mesmo relógio físico atendendo duas unidades diferentes.
- `rep_vinculos_servidor`, `rep_cadastros_fila`, `rep_afd_registros`, `rep_usuarios_dispositivo`
  já operam por **servidor**, não por setor — nenhuma mudança nelas.
- O comportamento hoje coberto por `setor_id NULL` ("toda a unidade") continua idêntico: 0 linhas
  na tabela de junção reproduz exatamente a mesma condição `IS NULL OR ...` de hoje.

## Nota à parte: `terminais_locais` tem o mesmo padrão

`terminais_locais.setor_id` (`20260811180000`) é a mesma FK única e opcional, pelo mesmo motivo —
mas ali "compartilhar" tem outro significado: é uma tela de navegador (não um relógio físico com
`numero_serie`), e cada terminal já pode ser instalado em quantas máquinas quiser. Se aparecer um
caso real de setores dividindo o mesmo terminal local com a mesma necessidade de granularidade,
vale revisitar — mas não faz parte deste plano.

---

## Resumo executivo

| # | o quê | onde |
|---|---|---|
| 1 | `dispositivos_rep.setor_id` (FK única) não representa "N setores, não todos" | causa raiz |
| 2 | contornar duplicando o registro do dispositivo esbarra em `uq_dispositivo_serie` e fragmenta vínculo/AFD | alternativa descartada |
| 3 | tabela de junção `dispositivos_rep_setores`, 0 linhas = "toda a unidade" (compatível com o comportamento atual) | solução |
| 4 | 3 funções de banco + `actions.ts` + modal + aba Cobertura precisam mudar juntos; coluna antiga só sai depois que nada mais a lê | sequência |
| 5 | **folha de ponto não depende deste campo hoje** — a Fase 5 (reconciliação, o único caminho que ligaria relógio → folha) não tem nenhum chamador em `src/`; a folha continua vindo 100% do terminal clássico/validação manual, em toda unidade, LACEM incluída | achado da revisão de risco |
| 6 | `marcacoes_ponto.setor_id` (o que o relógio grava) não é lido por RLS, pela alocação de batidas nem por nenhuma tela — simplifica a etapa 2 (gravar `NULL` para dispositivo multi-setor, sem resolver por servidor) | achado da revisão de risco |

**Avaliação de risco:** baixo, e confinado ao módulo REP em construção (piloto da TI + rollout da
LACEM) — não toca escala, grade, terminal clássico, Portal nem geração de folha/PDF. Migration
prevista: schema aditiva sozinha primeiro (`202608131[3]0000`, reversível, sem mudar
comportamento), funções numa segunda leva com checkpoint de conferência antes de prosseguir
(`202608131[4]0000`), `actions.ts`+UI no mesmo PR depois, e uma migration final — sem pressa —
separada só para derrubar a coluna antiga.
