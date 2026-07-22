# Documentação de Evolução - Versão 1.11.0 (2026-07-22)

## 📋 Resumo Executivo

A versão **1.11.0** implementa a solução completa de **Recuperação de Senha ("Esqueceu a senha?")** no **SisEscala**, com integração de e-mail SMTP via **Google Workspace (Gmail Institucional)** em ambiente **Self-Hosted Supabase no Coolify (Oracle Cloud)**.

Além da funcionalidade de recuperação por e-mail, foi criada uma infraestrutura dinâmica de templates em português e a tradução global de erros de autenticação para o usuário.

---

## 🎯 Principais Funcionalidades & Implementações

### 1. Fluxo de Autenticação & Recuperação PKCE (`Next.js App Router`)
- **Manipulador de Callback (`/auth/callback`)**:
  - Criado o handler `src/app/auth/callback/route.ts` que recebe o código PKCE seguro gerado pelo e-mail de recuperação do Supabase e o troca por cookies de sessão autenticada (`exchangeCodeForSession`), redirecionando automaticamente para a página `/resetar-senha`.
- **Rotas Públicas no Middleware**:
  - Atualizado `src/utils/supabase/middleware.ts` para liberar as rotas `/esqueci-a-senha`, `/resetar-senha`, `/auth` e `/api/templates` do bloqueio de redirecionamento para o login.

### 2. Integração SMTP Institucional (Google Workspace + Supabase Self-Hosted)
- **Configuração de Provedor SMTP no Coolify**:
  - Configurado o servidor `smtp.gmail.com:587` com conta da Secretaria Municipal de Saúde (`informatica.sms@maraba.pa.gov.br`) via Senha de App corporativa.
  - Correção nas variáveis do Coolify (`SMTP_*` e `GOTRUE_SMTP_*`) e alinhamento do `API_EXTERNAL_URL` com a URL pública do Supabase Kong (`https://supabase-sisescala.coolify.vps.atb.app.br`).
- **Segurança e Firewall**:
  - Liberação de portas TCP de saída 587/465 nas Egress Rules da Oracle Cloud Infrastructure (OCI) e no UFW local da VPS Linux.

### 3. Template de E-mail Personalizado em Português (`/api/templates/recovery`)
- **Rota Dinâmica de Template**:
  - Criada a rota de API pública `src/app/api/templates/recovery/route.ts` para servir o template de e-mail oficial sem depender de downloads externos ou sofrer problemas de escaping de HTML em variáveis de ambiente.
- **Identidade Visual da Prefeitura de Marabá**:
  - Template responsivo em HTML com o cabeçalho oficial (`SisEscala - Secretaria Municipal de Saúde • Marabá-PA`), botão de ação em destaque e código numérico de verificação em tamanho estendido (34px, negrito).

### 4. Tradução de Mensagens de Erro (`src/utils/auth-errors.ts`)
- **Módulo `translateAuthError`**:
  - Interceptação de mensagens nativas em inglês do Supabase Auth e tradução automática para português amigável nas telas de Login, Esqueci a Senha e Redefinição de Senha.
  - Exemplo: *"New password should be different from the old password."* ➔ *"A nova senha deve ser diferente da senha antiga."*

---

## 🛠️ Arquivos Criados & Alterados

- `[NEW]` [src/app/auth/callback/route.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/auth/callback/route.ts)
- `[NEW]` [src/app/api/templates/recovery/route.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/api/templates/recovery/route.ts)
- `[NEW]` [src/utils/auth-errors.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/auth-errors.ts)
- `[NEW]` [public/templates/recovery.html](file:///c:/Users/Cliente/Projetos/SisEscala/public/templates/recovery.html)
- `[NEW]` [docs/evolucao/2026-07-22-recuperacao-de-senha-e-integracao-smtp-supabase-v1.11.0.md](file:///c:/Users/Cliente/Projetos/SisEscala/docs/evolucao/2026-07-22-recuperacao-de-senha-e-integracao-smtp-supabase-v1.11.0.md)
- `[MODIFY]` [src/utils/supabase/middleware.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/supabase/middleware.ts)
- `[MODIFY]` [src/app/esqueci-a-senha/actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/esqueci-a-senha/actions.ts)
- `[MODIFY]` [src/app/resetar-senha/actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/resetar-senha/actions.ts)
- `[MODIFY]` [src/app/login/actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/login/actions.ts)
- `[MODIFY]` [.env.production](file:///c:/Users/Cliente/Projetos/SisEscala/.env.production)
- `[MODIFY]` [package.json](file:///c:/Users/Cliente/Projetos/SisEscala/package.json)
- `[MODIFY]` [README.md](file:///c:/Users/Cliente/Projetos/SisEscala/README.md)
- `[MODIFY]` [CHANGELOG.md](file:///c:/Users/Cliente/Projetos/SisEscala/CHANGELOG.md)
