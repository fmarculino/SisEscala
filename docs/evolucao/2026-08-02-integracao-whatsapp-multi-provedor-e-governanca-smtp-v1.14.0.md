# Documentação de Evolução - Versão 1.14.0 (2026-08-02)

A versão **1.14.0** do **SisEscala** traz a consolidação da **Integração Flexível de WhatsApp (Multi-Provedor)** e a **Governança Centralizada de Comunicação (E-mail SMTP & WhatsApp)** no painel de Configurações do Sistema (`/configuracoes`), adicionando suporte nativo ao envio de mensagens via **AstraCalls API**, **Chatwoot API** e **API HTTP Genérica Customizável**, com garantia de **Fallback Manual (WhatsApp Web/App)** para contingência e ferramentas de teste em tempo real.

---

## 🎯 Principais Funcionalidades Implementadas

### 💬 1. Módulo Unificado de Comunicação e Multi-Provedor WhatsApp (`src/app/actions/communication.ts`)
- **AstraCalls API (Preset Padrão)**: Disparo automático direto via HTTP REST para `POST {url}/api/sessions/{sid}/messages/text` enviando a chave no header `X-API-Key`.
- **Chatwoot API (Preset)**: Suporte ao envio de mensagens por meio de canais API/conversas do Chatwoot (`POST {url}/api/v1/accounts/{account_id}/conversations`).
- **API HTTP Genérica / Customizada (Totalmente Agnóstica)**: Permite a integração com qualquer outro gateway (ex: Evolution API, Z-API, WPPConnect, etc.) configurando livremente Endpoint, Método HTTP (POST/PUT), Headers customizados e **Template de Payload JSON** com marcadores `{{phone}}` e `{{message}}`.
- **Modo Manual**: Opção para manter o redirecionamento tradicional para WhatsApp Web.

### 🛡️ 2. Mecanismo de Fallback Inteligente (Contingência Garantida)
- Se a requisição para a API do provedor selecionado falhar (status HTTP >= 400, timeout ou desconexão da conta), o sistema captura a exceção, exibe o aviso com a mensagem exata do erro e gera proeminentemente o botão **"Enviar via WhatsApp Web (Manual)"** com a URL de deep link pré-formatada.

### ⚙️ 3. Governança de Comunicação no Menu `/configuracoes`
- **Painel WhatsApp (Multi-Provedor)**: Seleção visual do provedor ativo, gerenciamento de URLs, SID, API Keys, Headers e Templates JSON.
- **Painel Servidor de E-mail (SMTP)**: Gestão visual das credenciais SMTP (Host, Porta, Usuário, Senha mascarada, Remetente e Criptografia TLS/SSL).
- **Modais de Teste em Tempo Real**: Botões dedicados **"Testar Conexão WhatsApp"** e **"Testar Envio de E-mail"** para disparo imediato de mensagens de teste com exibição do log e status HTTP retornado antes de salvar as alterações em produção.

### 🚀 4. Atualização dos Pontos de Disparo de WhatsApp
- **Acionamento de Sobreaviso (`ScaleGrid.tsx`)**: O botão de envio de notificação no modal de sobreaviso agora dispara via API com indicador visual de carregamento (`waSending`), toast de confirmação e bloco de fallback em caso de erro.
- **Compartilhamento de PIN do Servidor (`EditServidorForm.tsx` & `novo/page.tsx`)**: Atualizado para envio por API com fallback automático.

---

## 🗄️ Estrutura de Banco de Dados (`configuracoes_globais`)

Todas as opções são armazenadas no banco de dados na tabela `configuracoes_globais` no padrão Chave-Valor, garantindo persistência imediata sem necessidade de alterações em arquivos `.env`:
- `whatsapp_modo`
- `whatsapp_astracall_url`, `whatsapp_astracall_sid`, `whatsapp_astracall_key`
- `whatsapp_chatwoot_url`, `whatsapp_chatwoot_account_id`, `whatsapp_chatwoot_inbox_id`, `whatsapp_chatwoot_token`
- `whatsapp_custom_url`, `whatsapp_custom_method`, `whatsapp_custom_headers`, `whatsapp_custom_payload`
- `whatsapp_permitir_fallback`
- `email_smtp_habilitado`, `email_smtp_host`, `email_smtp_porta`, `email_smtp_usuario`, `email_smtp_senha`, `email_smtp_seguranca`, `email_smtp_remetente_email`, `email_smtp_remetente_nome`

---

## 🧪 Validação e Testes
- **Compilação Next.js**: `npm run build` executado com sucesso (`✓ Compiled successfully in 8.5s` e 41 páginas estáticas/dinâmicas geradas).
