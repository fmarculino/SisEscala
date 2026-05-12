# Diagnóstico Técnico e Plano de Escalabilidade - SisEscala

Este documento contém a análise técnica realizada em Maio de 2026, focada na prontidão do sistema SisEscala para implementação em larga escala (cenário de Prefeitura).

## 1. Visão Geral do Sistema
O SisEscala é uma aplicação full-stack construída com **Next.js 15** e **Supabase**. Ele gerencia escalas de trabalho, controle de presença e acionamento de sobreaviso.

### Métricas de Escalabilidade Alvo:
- **Secretarias**: 15
- **Departamentos/Setores**: 150+
- **Servidores**: 10.000
- **Administradores/Coordenadores**: 300
- **Escalas Mensais**: ~250

---

## 2. Diagnóstico de Segurança

### Vulnerabilidades Identificadas
1. **PIN de Acesso Exposto**:
   - **Local**: Tabela `public.servidores`, coluna `pin_acesso`.
   - **Problema**: Armazenamento em texto plano.
   - **Solução Necessária**: Migrar para armazenamento de hash (ex: bcrypt) e validar via RPC no banco de dados.

2. **Ausência de Rate Limiting**:
   - **Local**: `src/app/consultar-escala/actions.ts` -> `validatePin`.
   - **Problema**: Permite ataques de força bruta no PIN.
   - **Solução Necessária**: Implementar um limitador de tentativas por IP/Matrícula.

3. **Riscos de IDOR (Insecure Direct Object Reference)**:
   - **Local**: Funções que utilizam `createAdminClient()`.
   - **Problema**: Ao usar a chave de serviço (service_role), o sistema ignora o RLS. Se a lógica da aplicação não validar rigorosamente o vínculo do servidor com a unidade/setor, um usuário pode ver dados de outros.
   - **Solução Necessária**: Reforçar a validação de sessão em cada Server Action.

---

## 3. Diagnóstico de Desempenho e Escalabilidade

### Gargalos de Banco de Dados
- **Indexação**: As tabelas `escala_diaria` e `logs_sistema` crescerão exponencialmente.
- **Sugestão de Índices**:
  ```sql
  CREATE INDEX idx_escala_mensal_unidade_setor ON public.escala_mensal (unidade_id, setor_id, mes, ano);
  CREATE INDEX idx_escala_diaria_mensal_id ON public.escala_diaria (escala_mensal_id);
  CREATE INDEX idx_logs_sistema_unidade_created ON public.logs_sistema (unidade_id, created_at);
  ```

### Gargalos de Frontend
- **Renderização da Grade**: O componente `ScaleGrid` processa muitos dados de uma só vez.
- **Solução**: Implementar **Virtualização de Listas** para que apenas os servidores visíveis na tela sejam renderizados no DOM.

### Gargalos de Processamento
- **Cálculos de Totais**: Atualmente feitos no client-side. Em escalas com muitos servidores, isso pode causar lentidão.
- **Solução**: Mover cálculos de horas e direitos adquiridos para **Materialized Views** ou funções **RPC** no PostgreSQL.

---

## 4. Plano de Implementação em Produção

Para suportar 10.000 servidores de forma estável, recomenda-se:

1. **Infraestrutura**:
   - Utilizar instâncias do Supabase com **IOPS otimizado**.
   - Configurar **Vercel Pro** com funções serverless na mesma região do banco (ex: `sa-east-1`).

2. **Monitoramento**:
   - Implementar logs detalhados de performance (tempo de resposta das RPCs).
   - Configurar alertas de uso de CPU no Supabase.

3. **Arquitetura de Dados**:
   - Avaliar o uso de **Particionamento de Tabelas** para `escala_diaria` por Ano/Mês caso o volume ultrapasse 10 milhões de linhas.

---
**Documentação gerada por:** Antigravity AI (Senior Systems Analyst)
**Data:** 11/05/2026
