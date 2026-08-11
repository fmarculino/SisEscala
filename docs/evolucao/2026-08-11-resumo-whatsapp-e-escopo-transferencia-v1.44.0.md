# Resumo de ponto por WhatsApp nunca disparava + escopo bloqueava solicitação de transferência (v1.44.0)

## 1. `fn_gerar_resumos_aviso_ponto()` nunca gerou uma linha sequer

**Sintoma relatado:** usuário fez opt-in no Portal do Servidor pedindo resumo diário no fim do
dia (09/08/2026 22:29) e nunca recebeu mensagem, apesar de ter turnos completos (entrada e saída)
dentro da janela de retroatividade de 3 dias.

**Confirmado em produção (11/08/2026):** zero linhas `tipo IN ('resumo_diario','resumo_semanal')`
em `avisos_ponto_fila` desde que a feature existe (v1.29.0). Chamada direta da RPC devolvia `0`,
sem erro visível — a função tem `EXCEPTION WHEN OTHERS THEN RETURN 0`, proposital ("não pode
derrubar o worker"), mas isso também escondia qualquer erro real acontecendo dentro dela.

**Causa suspeita:** a seção diária agrupava por uma expressão (`(ed.presenca_entrada_em AT TIME
ZONE v_timezone)::date`, posição 5 do `GROUP BY`) e repetia essa mesma expressão crua tanto no
`HAVING` quanto dentro de uma subquery correlacionada (`NOT EXISTS`) — um padrão válido em alguns
contextos do Postgres mas frágil, principalmente dentro da subquery.

**Correção** (`supabase/migrations/20260811120000_fix_resumo_aviso_ponto_query.sql`): reescrita
com CTE — `dia` vira coluna material antes de agrupar (`base` → `agrupado`), e o filtro
pós-agregação passa a ser um `WHERE` simples sobre colunas já agrupadas, sem expressão raw nem
correlação ambígua. Elimina a classe inteira do problema, independente de qual sintaxe exata
estava falhando. A seção semanal não tem `GROUP BY` — não sofre do mesmo padrão, entrou
inalterada.

Durante a reescrita, preservado o contorno já existente para `min(uuid)`/`max(uuid)` — Postgres
não tem agregado de fábrica para `uuid`, por isso `min(unidade_id::text)::uuid` em vez de
`min(unidade_id)` direto.

**Erro deixa de ser silencioso:** o `EXCEPTION WHEN OTHERS` agora grava em `logs_sistema` (mesmo
padrão de `fn_expurgar_logs`, `20260809210000`) antes de devolver 0.

**Verificado em produção após aplicar:** `fn_gerar_resumos_aviso_ponto()` gerou 4 resumos diários
na primeira chamada (referências 08/08 e 10/08, um deles `resumo_incompleto`), todos com
`status = 'enviado'` — a fila está sendo despachada normalmente pelo worker existente
(`/api/avisos-ponto/despachar`), só nunca tinha nada para despachar.

## 2. Solicitação de transferência ficava invisível para quem mais precisava dela

O workflow de aprovação (v1.43.0) previa: coordenador/admin **solicita** uma transferência,
`super_admin` aprova ou rejeita. `src/app/(dashboard)/servidores/[id]/page.tsx` continuava
passando as listas de `unidades`/`setores` por `applyAccessFilters(query, userProfile, ...)` — o
mesmo filtro de escopo usado em toda a aplicação para restringir o que um coordenador enxerga.

Isso tornava o próprio propósito da feature inatingível: um coordenador só podia escolher, no
seletor de lotação, unidades/setores **já dentro do seu escopo** — exatamente o caso em que a
transferência não precisaria de aprovação alguma. O caso real (propor destino **fora** do que
administra) nunca aparecia como opção no formulário.

**Correção:** removido `applyAccessFilters` das duas queries (`unidades`, `setores`) nessa página.
A escrita continua protegida em duas camadas independentes do escopo do `<select>`: RLS de
`servidores` recusa `UPDATE` fora do escopo de quem edita, e `updateServidor` só efetiva a
transferência na hora se quem está salvando for `super_admin` — do contrário grava pedido em
`solicitacoes_transferencia_servidor`. Sem migration; mudança só de leitura no server component.

## Verificação

- `npx tsc --noEmit` e `npm run build` limpos após as duas correções.
- Resumo diário confirmado gerando e despachando em produção (ver acima).
- Escopo do seletor de transferência precisa de conferência manual no navegador com um usuário
  coordenador/admin (não-super_admin) — não há login desse papel disponível neste ambiente.
