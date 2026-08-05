# Diretrizes e Regras do Projeto SisEscala

## Regras de Banco de Dados e Migrações (PostgreSQL / Supabase)

### Alinhamento Dinâmico de Horas Extras em `fn_confirmar_presenca` e `fn_confirmar_presenca_manual`
- Ao modificar ou recriar as funções PostgreSQL `public.fn_confirmar_presenca` ou `public.fn_confirmar_presenca_manual`:
  - **MANTENHA OBRIGATORIAMENTE** a subconsulta de alinhamento dinâmico do horário de início da categoria `Extra` (`ed.categoria = 'Extra'`).
  - O cálculo do `start_hour` para a categoria `Extra` deve buscar o término do turno `Regular` ou `Plantão` do mesmo dia (incluindo tratamento para turnos noturnos que cruzam a meia-noite, como `Plantão N` 18h às 06h do dia seguinte).
  - **Causa da Regressão Histórica (04/08/2026)**: A omissão dessa subconsulta faz com que a hora extra pós-plantão assuma a hora padrão (07:00 da manhã do próprio dia do plantão), fragmentando o bloco de trabalho contínuo. Como consequência, a tentativa de registrar a saída no dia seguinte (ex: 07:00) expira e é negada alegando que o servidor não possui escala no horário.
