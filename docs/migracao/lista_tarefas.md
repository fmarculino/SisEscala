# Lista de Tarefas: Migração SisEscala (Vercel/Supabase -> VPS/Coolify)

Abaixo está o registro de tarefas concluídas durante o processo de migração da infraestrutura:

- `[x]` **Fase 1: Extração do esquema DDL e dados do Supabase de produção antigo**
  - `[x]` Escrever e rodar script para exportar enums públicos.
  - `[x]` Escrever e rodar script para exportar tabelas e relacionamentos públicos.
  - `[x]` Escrever e rodar script para exportar funções customizadas e triggers.
  - `[x]` Escrever e rodar script para exportar políticas de RLS.
  - `[x]` Escrever e rodar script para exportar usuários e identidades de autenticação (`auth.users`, `auth.identities`).
  - `[x]` Escrever e rodar script para extrair dados de todas as tabelas públicas da aplicação.
- `[x]` **Fase 2: Geração do Script SQL Unificado de Migração**
  - `[x]` Agrupar esquema DDL, dados de autenticação e dados da aplicação em um único arquivo `scratch/migration_dump.sql` bem estruturado.
  - `[x]` Adicionar desativação temporária de triggers e verificações de chaves estrangeiras no início do script para evitar conflitos de ordem na carga de dados (replica role).
- `[x]` **Fase 3: Aplicação e Teste**
  - `[x]` Fornecer o script SQL para o usuário executar no SQL Editor da VPS.
  - `[x]` Validar contagem de linhas e integridade após a execução do script na VPS (teste com `dicionario_setores`).
  - `[x]` Orientar o usuário a configurar as variáveis no Coolify e subir o serviço.
  - `[x]` Resolver o erro de login "Database error querying schema" (Ajustar campos NULL de tokens em `auth.users`).
- `[x]` **Fase 4: Finalização e Cutover**
  - `[x]` Validar funcionamento da aplicação SisEscala na VPS (login bem-sucedido e navegação liberada).
  - `[x]` Criar arquivos de documentação (`plano_implementacao.md`, `relatorio_final.md`, `lista_tarefas.md`) na pasta `docs/migracao/`.
  - `[x]` Realizar limpeza de arquivos temporários desnecessários e dados sensíveis gerados localmente.
