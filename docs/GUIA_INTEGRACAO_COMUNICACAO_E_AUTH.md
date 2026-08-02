# 📘 Guia Técnico de Integração: Comunicação (WhatsApp & E-mail) e Recuperação de Senha (Supabase Auth SSR)

Este documento foi elaborado para servir como **referência completa de reutilização e arquitetura** para a implementação dos módulos de comunicação via WhatsApp (AstraCalls), E-mail SMTP e Recuperação de Senha nos sistemas **SistEA** e **SisFilaSUS**, utilizando os padrões consagrados e testados em produção no **SisEscala**.

---

## 📑 Índice
1. [Visão Geral e Arquitetura](#1-visão-geral-e-arquitetura)
2. [Motor de Comunicação via WhatsApp (AstraCalls)](#2-motor-de-comunicação-via-whatsapp-astracalls)
   - [Tratamento Automático do 9º Dígito no Brasil (DDDs >= 31)](#tratamento-automático-do-9º-dígito-no-brasil-ddds--31)
   - [Fallback Automático e Envio Manual via WhatsApp Web](#fallback-automático-e-envio-manual-via-whatsapp-web)
3. [Motor de Envio de E-mail Transacional (SMTP Nodemailer)](#3-motor-de-envio-de-e-mail-transacional-smtp-nodemailer)
4. [Estrutura do Banco de Dados e Herança de Configurações](#4-estrutura-do-banco-de-dados-e-herança-de-configurações)
5. [Fluxo Completo de Recuperação de Senha (Supabase Auth SSR)](#5-fluxo-completo-de-recuperação-de-senha-supabase-auth-ssr)
6. [Parâmetros e Variáveis de Ambiente](#6-parâmetros-e-variáveis-de-ambiente)

---

## 1. Visão Geral e Arquitetura

O módulo de comunicação foi desenvolvido no Next.js (App Router) utilizando **Server Actions** em TypeScript, integração nativa com o **Supabase Auth (SSR)** e bibliotecas leves (`nodemailer`).

### Diagrama do Fluxo de Comunicação
```
┌─────────────────────────────────────────────────────────────┐
│                    Requisição de Disparo                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
    [ Canal: WhatsApp ]               [ Canal: E-mail ]
               │                               │
               ▼                               ▼
  Verifica DDD (>= 31?)              Resolve Config (Unidade/Global)
  Converte 13 p/ 12 dígitos                    │
               │                               ▼
               ├──────────────────────► Dispara SMTP Nodemailer
               ▼
  POST /message/text (AstraCalls)
               │
      ┌────────┴────────┐
      ▼                 ▼
   Sucesso?          Falhou?
   [ OK ]        Retry com 13 dígitos
                        │
                        ▼
                Link WhatsApp Web (Manual)
```

---

## 2. Motor de Comunicação via WhatsApp (AstraCalls)

O AstraCalls (engine WAHA/WA-Calls) utiliza requisições HTTP REST com autenticação via cabeçalho `X-API-Key`.

### Parâmetros Obrigatórios da API AstraCalls:
- **Base URL**: `https://astracall.atb.app.br` (ou definida no ambiente).
- **Session Name**: Nome da sessão pareada via QR Code (ex: `inbox3_acc6`).
- **X-API-Key**: Chave global da API (ex: `WACALLS_API_KEY`).
- **Endpoint**: `POST /message/text`
- **Body (JSON)**:
  ```json
  {
    "session": "inbox3_acc6",
    "chatId": "5594981034808@s.whatsapp.net",
    "text": "Conteúdo da mensagem..."
  }
  ```

---

### Tratamento Automático do 9º Dígito no Brasil (DDDs >= 31)

> [!IMPORTANT]
> **Regra do WhatsApp no Brasil**: Números do Brasil com DDD maiores ou iguais a 31 (ex: Pará `94`, Pernambuco `81`, Bahia `71`, MG `31`) são registrados nos servidores do WhatsApp **sem o nono dígito** (12 dígitos no total: `55` + `DDD` + `8 dígitos`). Enviar para 13 dígitos pode falhar no envio via API.

#### Algoritmo de Normalização de Telefone (TypeScript):
```typescript
/**
 * Retorna as variações válidas de formato de telefone para WhatsApp no Brasil.
 * Prioriza a versão de 12 dígitos (sem o 9º dígito extra para DDDs >= 31).
 */
export function getWhatsAppPhoneVariants(phoneRaw: string): string[] {
  const digitsOnly = phoneRaw.replace(/\D/g, '');
  if (!digitsOnly) return [];

  // Garante o código do país 55
  let phone = digitsOnly.startsWith('55') ? digitsOnly : `55${digitsOnly}`;

  // Se for número do Brasil com 13 dígitos (55 + 2 dígitos DDD + 9 dígitos número)
  if (phone.length === 13 && phone.startsWith('55')) {
    const ddd = parseInt(phone.substring(2, 4), 10);
    // Para DDDs >= 31, o servidor do WhatsApp usa internamente o formato de 12 dígitos
    if (ddd >= 31 && phone[4] === '9') {
      const variant12 = `55${phone.substring(2, 4)}${phone.substring(5)}`;
      // Retorna primeiro a versão de 12 dígitos e, em fallback, a de 13 dígitos
      return [variant12, phone];
    }
  }

  return [phone];
}
```

#### Código de Envio com Retry Duplo (AstraCalls Action):
```typescript
export async function sendWhatsAppMessageAction(params: {
  phone: string;
  message: string;
  unidadeId?: string;
}) {
  const { phone, message, unidadeId } = params;
  
  // 1. Resolve credenciais (Unidade customizada ou Global)
  const config = await getCommunicationConfig(unidadeId);
  if (!config.wacalls_session) {
    return { success: false, error: 'Sessão do WhatsApp não configurada.' };
  }

  const baseUrl = (config.wacalls_url || 'https://astracall.atb.app.br').replace(/\/$/, '');
  const apiKey = config.wacalls_api_key || '';
  const session = config.wacalls_session;

  const phoneVariants = getWhatsAppPhoneVariants(phone);
  let lastError = '';

  // 2. Tenta primeiro com a variante de 12 dígitos e depois de 13 dígitos
  for (const targetPhone of phoneVariants) {
    const chatId = `${targetPhone}@s.whatsapp.net`;
    try {
      const response = await fetch(`${baseUrl}/message/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          session,
          chatId,
          text: message,
        }),
      });

      if (response.ok) {
        return { success: true, phoneUsed: targetPhone };
      }

      const errText = await response.text();
      lastError = `HTTP ${response.status}: ${errText}`;
    } catch (err: any) {
      lastError = err.message || 'Erro na requisição';
    }
  }

  return { success: false, error: lastError };
}
```

---

### Fallback Automático e Envio Manual via WhatsApp Web

Para garantir contingência 100% à prova de falhas na interface do usuário (ex: se o servidor estiver sem sinal ou o serviço da API oscilar), mantenha um botão manual utilizando o protocolo `api.whatsapp.com`:

```typescript
export function getWhatsAppWebUrl(phoneRaw: string, message: string): string {
  const digitsOnly = phoneRaw.replace(/\D/g, '');
  const phone = digitsOnly.startsWith('55') ? digitsOnly : `55${digitsOnly}`;
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
}
```

---

## 3. Motor de Envio de E-mail Transacional (SMTP Nodemailer)

Instale a dependência `nodemailer` (`npm install nodemailer @types/nodemailer`).

```typescript
import nodemailer from 'nodemailer';

export async function sendEmailAction(params: {
  to: string;
  subject: string;
  html: string;
  unidadeId?: string;
}) {
  const { to, subject, html, unidadeId } = params;
  const config = await getCommunicationConfig(unidadeId);

  if (!config.smtp_host || !config.smtp_user) {
    return { success: false, error: 'Servidor SMTP não configurado.' };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp_host,
    port: parseInt(config.smtp_port || '587', 10),
    secure: config.smtp_secure === 'true' || config.smtp_port === '465',
    auth: {
      user: config.smtp_user,
      pass: config.smtp_pass,
    },
  });

  try {
    await transporter.sendMail({
      from: `"${config.smtp_from_name || 'Sistema'}" <${config.smtp_from_email || config.smtp_user}>`,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
```

---

## 4. Estrutura do Banco de Dados e Herança de Configurações

### Tabela em Postgres / Supabase: `configuracoes_gerais`

```sql
CREATE TABLE IF NOT EXISTS public.configuracoes_gerais (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Chaves de Configuração Recomendadas:
- `wacalls_url` (`https://astracall.atb.app.br`)
- `wacalls_api_key` (`CotEnKV5ykYG5HKiSQizExXnmVnCYFXM`)
- `wacalls_session` (`inbox3_acc6`)
- `smtp_host` (`smtp.gmail.com` ou servidor municipal)
- `smtp_port` (`587`)
- `smtp_user` (`notificacoes@maraba.pa.gov.br`)
- `smtp_pass` (`********`)
- `smtp_from_name` (`Prefeitura de Marabá`)

---

## 5. Fluxo Completo de Recuperação de Senha (Supabase Auth SSR)

### 1. Envio do Link de Recuperação (`/esqueci-a-senha`)

No Server Component ou Server Action:
```typescript
import { createClient } from '@/utils/supabase/server';

export async function requestPasswordResetAction(email: string) {
  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'https://sisecala.vps.atb.app.br';
  
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?type=recovery`,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
```

### 2. Trata a Troca de Token no Callback (`/auth/callback/route.ts`)

```typescript
import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const type = requestUrl.searchParams.get('type');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error && type === 'recovery') {
      // Redireciona o usuário autenticado para a página de redefinição de senha
      return NextResponse.redirect(`${requestUrl.origin}/resetar-senha`);
    }
  }

  return NextResponse.redirect(`${requestUrl.origin}/login?error=InvalidToken`);
}
```

### 3. Redefinição da Senha (`/resetar-senha`)

Na página `/resetar-senha`:
```typescript
import { createClient } from '@/utils/supabase/client';

export async function updatePasswordAction(newPassword: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
```

---

## 6. Parâmetros e Variáveis de Ambiente

No arquivo `.env.local` / `.env.production` dos novos sistemas (`SistEA` e `SisFilaSUS`), configure:

```env
NEXT_PUBLIC_SUPABASE_URL=https://sua-instancia.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=https://sistea.vps.atb.app.br
WACALLS_URL=https://astracall.atb.app.br
WACALLS_API_KEY=CotEnKV5ykYG5HKiSQizExXnmVnCYFXM
```

---
*Documentação técnica gerada automaticamente a partir do código de produção do SisEscala (v1.16.5).*
