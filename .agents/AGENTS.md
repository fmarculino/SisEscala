# Diretrizes e Regras do Projeto SisEscala

## Regras de Banco de Dados e Migrações (PostgreSQL / Supabase)

### Alinhamento Dinâmico de Horas Extras em `fn_confirmar_presenca` e `fn_confirmar_presenca_manual`
- Ao modificar ou recriar as funções PostgreSQL `public.fn_confirmar_presenca` ou `public.fn_confirmar_presenca_manual`:
  - **MANTENHA OBRIGATORIAMENTE** a subconsulta de alinhamento dinâmico do horário de início da categoria `Extra` (`ed.categoria = 'Extra'`).
  - O cálculo do `start_hour` para a categoria `Extra` deve buscar o término do turno `Regular` ou `Plantão` do mesmo dia (incluindo tratamento para turnos noturnos que cruzam a meia-noite, como `Plantão N` 18h às 06h do dia seguinte).
  - **Causa da Regressão Histórica (04/08/2026)**: A omissão dessa subconsulta faz com que a hora extra pós-plantão assuma a hora padrão (07:00 da manhã do próprio dia do plantão), fragmentando o bloco de trabalho contínuo. Como consequência, a tentativa de registrar a saída no dia seguinte (ex: 07:00) expira e é negada alegando que o servidor não possui escala no horário.

### Fusão de Blocos Contínuos em `fn_confirmar_presenca` — Sobreaviso é Isolado
- Ao modificar ou recriar `public.fn_confirmar_presenca`:
  - **MANTENHA OBRIGATORIAMENTE** as condições `<> 'Sobreaviso'` nas **8 comparações de fusão de bloco** (`v_s2_inicio <= v_s1_fim`, `v_s3_inicio <= v_b1_fim`, `v_s3_inicio <= v_s2_fim`, nos laços de ontem e de hoje).
  - `Regular`, `Extra` e `Plantão` **devem** continuar fundindo entre si — é assim que 08h–18h + 2h extra + Plantão N 12h formam um único bloco contínuo.
  - `Sobreaviso` **nunca** funde: não é trabalho presencial, não marca presença e tem ciclo próprio em `logs_sobreaviso`.
- **Causa da Regressão Histórica (07/08/2026)**: o `start_hour` do Sobreaviso é alinhado ao fim do turno Regular (o 3º elemento do `COALESCE` de `start_hour` não filtra por categoria). Um Sobreaviso N12 encostava exatamente no fim da jornada (18:00) e fundia com ela, movendo a janela de saída para 06:00 do dia seguinte. O servidor batia o ponto às 18:00 e era recusado com "Fora da janela de presença permitida".

### Guard de Intervalo Intrajornada (CLT Art. 71)
- **MANTENHA OBRIGATORIAMENTE** a chamada a `public.fn_jornada_tem_intervalo` em `fn_confirmar_presenca` (dois laços) e em `fn_confirmar_presenca_manual` (ramos `intervalo_saida` e `intervalo_retorno`).
- **Causa da Regressão Histórica (04/08/2026)**: a migration `20260804080000` recriou a função e omitiu o guard `(v_end_min - v_start_min) > 240 AND COALESCE(r.intervalo_minutos, 0) > 0`, fazendo jornadas de 4h e 6h receberem fluxo de 4 batidas e gravarem a saída real como "saída para intervalo".
