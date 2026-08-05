# Relatório Técnico de Atualizações SisEscala v1.19.1

## 📌 Resumo Executivo
Esta versão traz correções técnicas no motor de presença, ajustes na política de segurança de dados (RLS) para gestores de unidade/setor e aprimoramentos na interface gráfica de validação de escalas.

---

## 🛠️ Detalhamento das Alterações

### 1. Cálculo da Hora de Início do Turno `T` (Jornadas 12H ÀS 18H)
- **Arquivo / Migração**: `supabase/migrations/20260804050000_fix_shift_t_12h_jornada_start.sql`
- **Funções Atualizadas**: `public.fn_confirmar_presenca` e `public.fn_confirmar_presenca_manual`
- **Problema Resolvido**: Servidores cadastrados com jornada `12H ÀS 18H` e turno `T` tinham a hora de início calculada incorretamente como 13:00 (devido ao fallback de `MT`). As batidas registradas às 12:10 eram recusadas por estarem fora da janela.
- **Solução**: Adicionada cláusula explícita herdando `start_hour = 12` da jornada regular quando a hora de início estiver entre 11 e 14.

### 2. Suporte a Escopos de Validação na RPC `fn_confirmar_presenca_manual`
- **Arquivo / Migração**: `supabase/migrations/20260804050000_fix_shift_t_12h_jornada_start.sql`
- **Problema Resolvido**: Ao submeter a validação manual com os parâmetros `'completo'`, `'periodo_1'` ou `'periodo_2'`, a função lançava a exceção *"Tipo de presença inválido."*.
- **Solução**: Implementado o suporte a todos os 7 escopos de presença na cláusula `IF/ELSIF` da RPC.

### 3. Permissão RLS para Coordenadores e Administradores
- **Arquivo / Migração**: `supabase/migrations/20260804060000_allow_coordinators_admins_read_denied_attempt_logs.sql`
- **Tabela**: `public.logs_tentativas_presenca`
- **Problema Resolvido**: O quadro de recusas do terminal no modal de validação manual só aparecia para o Administrador Geral (`super_admin`).
- **Solução**: Criada a política RLS `Allow authorized users read logs`, liberando a leitura para perfis `super_admin`, `admin` e `coordenador`.

### 4. Rótulos Dinâmicos do Escopo de Validação na Interface
- **Arquivo**: `src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx`
- **Problema Resolvido**: Os botões do modal de validação exibiam descrições estáticas `(Manhã)` e `(Tarde)` mesmo para turnos noturnos, de tarde ou plantões.
- **Solução**: Cálculo dinâmico das legendas dos botões conforme o turno do dia:
  - Turnos Divididos (`MT`): `Manhã (07h-11h)` e `Tarde (13h-17h)`
  - Turnos de Tarde (`T`): `Entrada Tarde` e `Saída Tarde`
  - Turnos Noturnos (`N`): `Entrada Noturna` e `Saída Noturna`
  - Genérico: `1º Turno / Entrada` e `2º Turno / Saída`
