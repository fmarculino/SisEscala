# Documentação de Evolução - Versão 1.11.0 (2026-07-22)

## 📋 Resumo Executivo

A versão **1.11.0** implementa a solução completa de **Recuperação de Senha ("Esqueceu a senha?")** no **SisEscala**, com integração de e-mail SMTP via **Google Workspace (Gmail Institucional)** em ambiente **Self-Hosted Supabase no Coolify (Oracle Cloud)**, além de **Melhorias e Ajustes no Painel de Controle (Gráfico de Comparativo Histórico de Horas)**.

Além das funcionalidades de autenticação por e-mail, foi atualizado o componente de histórico de horas com acompanhamento em tempo real do mês vigente, escala no Eixo Y e seleção interativa.

---

## 🎯 Principais Funcionalidades & Implementações

### 1. Painel de Controle — Gráfico de Comparativo Histórico de Horas (`HistoricoChart`)
- **Acompanhamento em Tempo Real do Mês Vigente**:
  - Atualizada a consulta histórica em `src/app/(dashboard)/home/page.tsx` para não filtrar por status `Fechada` no mês atual, permitindo que a evolução das horas planejadas/executadas no mês vigente seja acompanhada dinamicamente ao longo dos dias.
- **Escala Vertical (Eixo Y) e Linhas de Grade**:
  - Adicionada escala no lado esquerdo com rótulos numéricos dinâmicos (`0h`, `2k h`, `4k h`, etc.) baseados no pico máximo de horas e linhas horizontais tracejadas (*gridlines*) de fundo para facilitar a leitura.
- **Correção da Altura das Barras (Flexbox CSS)**:
  - Corrigida a altura percentual das barras em `HistoricoChart.tsx` adicionando `h-full` no contêiner da coluna, garantindo que as barras verticais escalem na altura total do gráfico (160px) em vez de ficarem achatadas em 2px.
- **Seleção Interativa de Mês**:
  - Adicionados botões seletores de mês (`MAI`, `JUN`, `JUL`) e suporte a clique diretamente nas colunas do gráfico, atualizando instantaneamente os cartões inferiores (*Regular*, *Plantão*, *Sobreaviso*, *Extra*).

### 2. Fluxo de Autenticação & Recuperação PKCE (`Next.js App Router`)
- **Manipulador de Callback (`/auth/callback`)**:
  - Criado o handler `src/app/auth/callback/route.ts` que recebe o código PKCE seguro gerado pelo e-mail de recuperação do Supabase e o troca por cookies de sessão autenticada (`exchangeCodeForSession`), redirecionando automaticamente para a página `/resetar-senha`.
- **Rotas Públicas no Middleware**:
  - Atualizado `src/utils/supabase/middleware.ts` para liberar as rotas `/esqueci-a-senha`, `/resetar-senha`, `/auth` e `/api/templates` do bloqueio de redirecionamento para o login.

### 3. Integração SMTP Institucional (Google Workspace + Supabase Self-Hosted)
- **Configuração de Provedor SMTP no Coolify**:
  - Configurado o servidor `smtp.gmail.com:587` com conta da Secretaria Municipal de Saúde (`informatica.sms@maraba.pa.gov.br`) via Senha de App corporativa.
  - Correção nas variáveis do Coolify (`SMTP_*` e `GOTRUE_SMTP_*`) e alinhamento do `API_EXTERNAL_URL` com a URL pública do Supabase Kong (`https://supabase-sisescala.coolify.vps.atb.app.br`).
- **Segurança e Firewall**:
  - Liberação de portas TCP de saída 587/465 nas Egress Rules da Oracle Cloud Infrastructure (OCI) e no UFW local da VPS Linux.

### 4. Template de E-mail Personalizado em Português (`/api/templates/recovery`)
- **Rota Dinâmica de Template**:
  - Criada a rota de API pública `src/app/api/templates/recovery/route.ts` para servir o template de e-mail oficial sem depender de downloads externos ou sofrer problemas de escaping de HTML em variáveis de ambiente.
- **Identidade Visual da Prefeitura de Marabá**:
  - Template responsivo em HTML com o cabeçalho oficial (`SisEscala - Secretaria Municipal de Saúde • Marabá-PA`), botão de ação em destaque e código numérico de verificação em tamanho estendido (34px, negrito).

### 5. Tradução de Mensagens de Erro (`src/utils/auth-errors.ts`)
- **Módulo `translateAuthError`**:
  - Interceptação de mensagens nativas em inglês do Supabase Auth e tradução automática para português amigável nas telas de Login, Esqueci a Senha e Redefinição de Senha.

---

## 🛠️ Arquivos Criados & Alterados

- `[NEW]` [src/app/auth/callback/route.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/auth/callback/route.ts)
- `[NEW]` [src/app/api/templates/recovery/route.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/api/templates/recovery/route.ts)
- `[NEW]` [src/utils/auth-errors.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/utils/auth-errors.ts)
- `[NEW]` [public/templates/recovery.html](file:///c:/Users/SMS-NTI/Projetos/sisescala/public/templates/recovery.html)
- `[NEW]` [docs/evolucao/2026-07-22-recuperacao-de-senha-e-integracao-smtp-supabase-v1.11.0.md](file:///c:/Users/SMS-NTI/Projetos/sisescala/docs/evolucao/2026-07-22-recuperacao-de-senha-e-integracao-smtp-supabase-v1.11.0.md)
- `[MODIFY]` [src/app/(dashboard)/home/_components/HistoricoChart.tsx](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/(dashboard)/home/_components/HistoricoChart.tsx)
- `[MODIFY]` [src/app/(dashboard)/home/page.tsx](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/(dashboard)/home/page.tsx)
- `[MODIFY]` [src/utils/supabase/middleware.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/utils/supabase/middleware.ts)
- `[MODIFY]` [src/app/esqueci-a-senha/actions.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/esqueci-a-senha/actions.ts)
- `[MODIFY]` [src/app/resetar-senha/actions.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/resetar-senha/actions.ts)
- `[MODIFY]` [src/app/login/actions.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/app/login/actions.ts)
- `[MODIFY]` [README.md](file:///c:/Users/SMS-NTI/Projetos/sisescala/README.md)
- `[MODIFY]` [CHANGELOG.md](file:///c:/Users/SMS-NTI/Projetos/sisescala/CHANGELOG.md)
