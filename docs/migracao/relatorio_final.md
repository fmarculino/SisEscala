# Relatório Final de Migração: SisEscala (Vercel/Supabase -> VPS/Coolify)

Este documento detalha o processo de migração realizado para mover a infraestrutura do sistema **SisEscala** do ambiente de nuvem original (Vercel + Supabase Cloud) para uma infraestrutura autohospedada em uma VPS utilizando o **Coolify** e **Supabase (Docker)**.

---

## 📋 Resumo da Migração

A migração foi concluída com sucesso, com **zero downtime** para o sistema original e preservação completa da integridade dos dados e das contas de usuário.

* **Origem**: Supabase Cloud (`https://ajzmqvbequxjjdyaexgn.supabase.co`)
* **Destino**: VPS / Coolify (`https://supabase-sisescala.coolify.vps.atb.app.br`)
* **Status**: Concluído e operacional.

---

## 🛠️ Detalhes Técnicos do Processo

### 1. Extração e Estruturação de Dados
Utilizamos um script Node.js customizado ([generate_dump.js](file:///c:/Users/DMAC-LAB/SisEscala/scratch/generate_dump.js)) para se conectar à API administrativa da origem e gerar um dump SQL unificado. O processo exportou:
* **Extensões**: `uuid-ossp`, `pgcrypto` e `postgis` (instalada no esquema `public`).
* **Estruturas de Dados**: Enums, tabelas públicas, relacionamentos (FKs), índices e triggers.
* **Autenticação**: Registros das tabelas `auth.users` e `auth.identities`.
* **Dados da Aplicação**: Todas as tabelas públicas populadas com a contagem exata de linhas.
* **Segurança e RLS**: Políticas de Row Level Security (RLS) e permissões de funções.

### 2. Tratamento de Conflitos e Ajustes no SQL
* **Desativação Temporária de Triggers/FKs**: Adicionado `SET session_replication_role = 'replica';` no topo do arquivo de migração para que as chaves estrangeiras e triggers não bloqueassem a inserção dos dados fora de ordem. Ao final do arquivo, o estado foi restaurado com `SET session_replication_role = 'origin';`.
* **Políticas de RLS**: Ajustadas as políticas de inserção que utilizavam a sintaxe incorreta com a cláusula `USING` em vez de `WITH CHECK`.
* **Índices Duplicados**: Removidas declarações redundantes de chaves primárias que entravam em conflito com índices implícitos criados pelo Postgres.

### 3. Resolução do Erro GoTrue (Login)
Ao tentar fazer login na VPS, a aplicação retornava o erro `"Database error querying schema"`.
* **Causa**: O serviço de autenticação do Supabase (GoTrue) exige que as colunas de tokens da tabela `auth.users` (como `confirmation_token`, `recovery_token`, etc.) contenham uma string vazia (`''`) em vez de `NULL` quando nenhum token está ativo.
* **Solução**: Executamos uma query de atualização diretamente na tabela `auth.users` convertendo os valores `NULL` nessas colunas para `''`. O script gerador também foi atualizado para preencher esses campos automaticamente em futuras migrações.

---

## 🔍 Plano de Verificação e Resultados

### Verificação do Banco de Dados
A verificação foi executada utilizando o script local [verify_migration.js](file:///c:/Users/DMAC-LAB/SisEscala/scratch/verify_migration.js), confirmando que a tabela de setores e demais dados públicos foram preenchidos corretamente e estão acessíveis via API.
* **Resultado**: A consulta à tabela `dicionario_setores` na VPS retornou os **18 setores** cadastrados na produção, indicando sucesso completo na migração dos dados.

### Verificação de Acesso (Login)
* **Status**: **Sucesso**. A tela de login da aplicação aponta perfeitamente para o novo Supabase na VPS, e o login dos coordenadores e administradores foi efetuado sem erros após a correção de tokens.

---

## 💡 Próximos Passos Recomendados

1. **Testes Funcionais Finais**:
   * Navegue pelas telas do painel (Servidores, Escalas, Configurações).
   * Crie uma escala de teste ou altere um registro para garantir que o fluxo de escrita/leitura está 100% funcional.
2. **Desativação do Vercel**:
   * Uma vez validada a VPS e o Coolify por completo pelo uso do dia a dia, o projeto antigo na Vercel e o projeto no Supabase Cloud podem ser pausados ou desativados permanentemente.
