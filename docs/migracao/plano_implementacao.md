# Plano de Migração: Vercel/Supabase Cloud para VPS/Coolify/Supabase Autohospedado

Este documento detalha o plano de migração estruturado para mover de forma segura o banco de dados e a aplicação **SisEscala** do ambiente original (Vercel + Supabase Cloud) para uma VPS própria gerenciada pelo Coolify (rodando a aplicação SisEscala e um Supabase autohospedado).

---

## 📌 Decisões de Escopo e Arquitetura

1. **Destino Final (Opção A):** Após a conclusão bem-sucedida da migração, a aplicação passará a rodar exclusivamente na VPS (Coolify/Supabase). O ambiente original na Vercel será desativado.
2. **Supabase Storage:** O sistema **não** utiliza recursos de Storage (armazenamento de arquivos de mídia), portanto não houve necessidade de migrar buckets ou arquivos binários.
3. **Análise do Erro de Chaves no Supabase da VPS:**
   * O erro ao tentar gerar ou atualizar chaves de API/JWT Secret pelo painel do Supabase Studio na VPS ("Failed to create API key" / "Failed to update JWT secret") é **esperado e normal em instalações autohospedadas (self-hosted)**. 
   * No Supabase self-hosted, essas chaves de segurança são estáticas e configuradas diretamente no arquivo `.env` do contêiner Docker/Coolify. O painel web do Studio tenta fazer chamadas à API de gerenciamento na nuvem da Supabase (Cloud Management API), o que gera falha por não estar conectado à infraestrutura deles.
   * **Como contornar:** As chaves necessárias (`anon` e `service_role`) já foram criadas na inicialização. A chave anon foi fornecida e a chave `service_role` foi mapeada como `${SERVICE_SUPABASESERVICE_KEY}` no Coolify.

---

## 🔄 Estratégia de Migração: Script SQL Unificado (Máxima Segurança)

Com base na nossa análise volumétrica, o banco de dados do **SisEscala** é extremamente leve:
* Total de registros da aplicação e usuários (excluindo dados espaciais do PostGIS) é de aproximadamente **300 linhas**.
* Como o volume de dados é pequeno, a melhor estratégia de migração foi gerar um **Script SQL Unificado** contendo:
  1. A criação de todas as tabelas, tipos enums, funções personalizadas, triggers e políticas de RLS.
  2. As instruções `INSERT` para migrar todos os usuários cadastrados (`auth.users` e `auth.identities`), permitindo que continuem logando com suas senhas atuais.
  3. As instruções `INSERT` para todas as tabelas públicas da aplicação (`setores`, `servidores`, `unidades`, `escalas`, `logs`, etc.).

**Vantagens dessa abordagem:**
* **Segurança:** Não é necessário expor a porta Postgres `5432` da VPS para a internet.
* **Simplicidade:** O usuário pôde simplesmente copiar o script gerado, abrir o **SQL Editor** do Supabase Studio na VPS e executá-lo em um clique.
* **Prevenção de Conflitos:** O script desativa temporariamente triggers e validações durante a inserção dos dados para evitar erros de integridade (via `session_replication_role = 'replica'`), ativando-os logo em seguida.

---

## 🛠️ Etapas do Plano de Ação

### 1. Geração do Script SQL de Migração (Local)
* Criação de um script automático ([generate_dump.js](file:///c:/Users/DMAC-LAB/SisEscala/scratch/generate_dump.js)) que roda na máquina local, conecta-se ao Supabase de produção antigo, extrai todo o esquema DDL e os dados, e compila tudo em um arquivo `scratch/migration_dump.sql`.

### 2. Execução no Supabase da VPS
* Execução do conteúdo de `scratch/migration_dump.sql` no painel SQL Editor da VPS.

### 3. Configuração das Variáveis de Ambiente no Coolify
* No painel do Coolify, definir as variáveis de ambiente apontando para o novo banco autohospedado:
  * `NEXT_PUBLIC_SUPABASE_URL=https://supabase-sisescala.coolify.vps.atb.app.br`
  * `NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ0eXAi...`
  * `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_SUPABASESERVICE_KEY}`

### 4. Testes e Validação na VPS
* Iniciar a aplicação no Coolify.
* Validar o login dos coordenadores e o carregamento dos dados de escala.

### 5. Desativação da Vercel
* Após a homologação da VPS, o domínio principal será apontado para o Coolify e o projeto da Vercel será pausado/desativado.
