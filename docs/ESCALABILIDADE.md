# Planejamento de Escalabilidade - SisEscala

Diretrizes para suportar o crescimento do sistema até 10.000 servidores e 150 departamentos.

## 1. Estratégia de Banco de Dados (Supabase/PostgreSQL)

### Particionamento de Tabelas
À medida que a tabela `escala_diaria` cresce (previsão de 3.6M registros/ano), o particionamento por **ano** ou **secretaria** pode ser necessário para manter o desempenho de consultas e manutenção (backups/vacuum).

### Índices de Performance
Devem ser criados índices para as colunas mais filtradas:
- `servidores(matricula)` - Único.
- `escala_mensal(unidade_id, setor_id, mes, ano)`.
- `escala_diaria(escala_mensal_id, dia)`.
- `logs_sobreaviso(token_magic_link)` - Crítico para o portal do servidor.

## 2. Otimização de Frontend (Next.js)

### Virtualização da Grade
A renderização de 10.000 células (ou mesmo 500 em um setor grande) causa gargalos no DOM.
- **Tecnologia**: Usar `@tanstack/react-virtual` ou `react-window`.
- **Benefício**: Reduz o uso de memória do navegador em até 80%.

### Cache de Dados
Utilizar o cache do Next.js para dados que mudam pouco:
- Lista de Unidades e Setores.
- Dicionário de Turnos.
- Feriados Nacionais e Municipais.

## 3. Concorrência e Realtime
O Supabase Realtime tem limites de conexões simultâneas e mensagens.
- **Ação**: Limitar as inscrições de realtime apenas às tabelas e IDs estritamente necessários para o administrador atual. Evitar `select *` em canais de realtime.

## 4. Próximos Passos para Produção
1. Realizar testes de carga (Load Testing) simulando 100 admins salvando escalas simultaneamente.
2. Monitorar o tempo de execução da RPC `fn_check_shift_conflicts`.
3. Validar o uso de memória do client-side em navegadores de hardware limitado (comum em repartições públicas).
