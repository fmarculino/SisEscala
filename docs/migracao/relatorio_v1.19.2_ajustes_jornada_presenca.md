# Relatório Técnico de Atualizações SisEscala v1.19.2

## 📌 Resumo Executivo
Esta versão corrige a herança do horário inicial (`start_hour`) das jornadas regulares de trabalho nas funções de presença (`fn_confirmar_presenca` e `fn_confirmar_presenca_manual`), solucionando divergências de janela de presença para jornadas como `08H ÀS 18H`, `18H ÀS 06H` e `12H ÀS 18H`.

---

## 🛠️ Detalhamento das Alterações

### 1. Herança Dinâmica da Hora Inicial da Jornada (`j.nome`)
- **Arquivo / Migração**: `supabase/migrations/20260804080000_fix_shift_n_18h_jornada_start.sql`
- **Funções Atualizadas**: `public.fn_confirmar_presenca` e `public.fn_confirmar_presenca_manual`
- **Problema Resolvido**: 
  - Servidores com jornada `08H ÀS 18H` (ex: Guilherme Soares Franco) tinham o horário inicial calculado incorretamente como `07:00` devido ao fallback da letra `M`/`MT`. As batidas efetuadas às `08:18` eram recusadas por estarem fora da janela (06:30 às 07:30). Ao final do dia, a saída das 18:18 era erroneamente assumida como Entrada.
  - Servidores com jornada `18H ÀS 06H` e turno `N` (ex: Ilmar da Silva de Oliveira) tinham a previsão calculada como `19:00`. As batidas efetuadas às `17:44` eram recusadas alegando `Previsão: 19:00`.
- **Solução**: Adicionada cláusula explícita herdando `start_hour = substring(j.nome from '^([0-9]+)')::integer` da jornada regular.

### 2. Unificação de Turnos Contíguos de Domingo (Plantão MT + Noturno N + Extra 1h)
- Preservado o agrupamento em blocos contíguos (`MT` 06h/07h-18h + `N` 18h-06h + `Extra` 06h-07h), unificando os 3 turnos em uma única jornada contínua (~25h), garantindo que a entrada seja gravada no início do plantão diurno e a saída no final da hora extra do dia seguinte.
- **Conformidade Regra `AGENTS.md`**: Mantida a subconsulta dinâmica de alinhamento da categoria `Extra`.

---

## 📋 Resumo das Migrações
| Arquivo | Descrição |
|---|---|
| `20260804080000_fix_shift_n_18h_jornada_start.sql` | Herança de `start_hour` por `j.nome` para categorias Regular e Plantão |
