# Guia de Endurecimento de Segurança (Security Hardening) - SisEscala

Este guia detalha as vulnerabilidades encontradas e as etapas necessárias para tornar o SisEscala seguro para um ambiente de produção governamental.

## 1. Gestão de Credenciais e PINs
A vulnerabilidade mais crítica é o armazenamento de PINs em texto claro.

### Ação Recomendada:
1. **Hashing**: Alterar o processo de salvamento de PIN para utilizar `bcrypt` ou `argon2`.
2. **Migração**: Criar um script para invalidar PINs atuais ou forçar a redefinição no primeiro acesso após a atualização.
3. **Validação**: A validação deve ocorrer no servidor, comparando o hash enviado com o do banco.

## 2. Row Level Security (RLS)
O sistema utiliza RLS, o que é excelente, mas existem pontos de falha potenciais.

### Auditoria de Políticas:
- **Profiles**: Garantir que um coordenador não consiga alterar o `role` de outro usuário via API.
- **Escalas**: Restringir a leitura de escalas diárias apenas para o próprio servidor ou para administradores da unidade correspondente.

## 3. Proteção de API e Server Actions
- **Rate Limiting**: Implementar limites de requisições em rotas de login e validação de PIN para mitigar ataques de força bruta.
- **Sanitização**: Embora o Next.js lide bem com isso, garantir que nenhum input de usuário seja usado diretamente em funções de string do PostgreSQL (prevenção de SQL Injection).

## 4. Auditoria e Logs
A tabela `logs_sistema` deve ser considerada imutável.
- **Configuração**: Bloquear comandos `UPDATE` e `DELETE` na tabela de logs para todos os usuários (incluindo admins).
- **Cobertura**: Adicionar logs para tentativas de login falhas e acessos a dados sensíveis de servidores.
