# SisEscala 📅

[![Version](https://img.shields.io/badge/version-1.1.0-green.svg)](https://github.com/fmarculino/SisEscala)
[![Next.js](https://img.shields.io/badge/framework-Next.js%2015-black.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/backend-Supabase-green.svg)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/styling-Tailwind%20CSS-38B2AC.svg)](https://tailwindcss.com/)

O **SisEscala** é uma plataforma robusta de gestão de escalas de trabalho e controle de presença, projetada especificamente para atender às complexidades de órgãos públicos e unidades de saúde que operam em regime multi-setorial e multi-unidade.

O sistema foca em **governança, segurança jurídica e eficiência operacional**, automatizando desde a criação da escala até o processamento de trocas e auditoria de presença.

---

## 🚀 Principais Funcionalidades

### 📋 Gestão de Escalas Inteligente
- **Multi-categoria**: Suporte nativo para turnos **Regulares**, **Extras**, **Plantões** e **Sobreaviso**.
- **Templates Dinâmicos**: Aplicação rápida de padrões de escala (**12x36**, **5x2**, **6x1**) com um clique.
- **Detecção de Conflitos**: Motor de validação global que impede que um servidor seja escalado em dois locais ao mesmo tempo.

### ⚖️ Compliance Legal (Motor de Regras)
- **Validação de Interjornada**: Alerta automático para períodos de descanso inferiores a 11 horas.
- **Validação de DSR**: Controle de Descanso Semanal Remunerado (7+ dias de trabalho).
- **Segurança Jurídica**: Alertas visuais preventivos para o coordenador antes do fechamento da folha.

### 🔄 Portal do Servidor (Autoatendimento)
- **Consulta em Tempo Real**: O servidor acessa sua escala individual via PIN ou matrícula.
- **Trocas de Plantão**: Fluxo completo de solicitação de trocas com justificativa e aprovação por coordenadores.
- **Notificações**: Status de solicitações (Aprovado/Rejeitado) visíveis instantaneamente.

### 🕒 Controle de Presença (Ponto Digital)
- **Check-in/Check-out**: Registro de entrada e saída via PIN com geolocalização (GPS).
- **Janela de Tolerância**: Bloqueio de batidas fora do horário permitido para evitar fraudes.
- **Auditoria Forense**: Trilha de auditoria detalhada para todas as batidas e ajustes manuais.

---

## 🛠️ Stack Tecnológica

- **Frontend**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS](https://tailwindcss.com/)
- **Ícones**: [Lucide React](https://lucide.dev/)
- **Backend/Banco de Dados**: [Supabase](https://supabase.com/) (PostgreSQL + RLS + Auth)
- **Deployment**: [Vercel](https://vercel.com/)

---

## 📦 Instalação e Configuração

### Pré-requisitos
- Node.js 20+
- Conta no Supabase

### Passo a Passo

1. **Clonar o repositório**
   ```bash
   git clone https://github.com/fmarculino/SisEscala.git
   cd SisEscala
   ```

2. **Instalar dependências**
   ```bash
   npm install
   ```

3. **Configurar Variáveis de Ambiente**
   Crie um arquivo `.env.local` na raiz e adicione suas chaves do Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=sua_url_aqui
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_key_anon_aqui
   SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui
   ```

4. **Configurar o Banco de Dados**
   O projeto utiliza migrações SQL localizadas na pasta `/supabase`. Execute o schema inicial no seu painel SQL do Supabase.

5. **Executar em modo de desenvolvimento**
   ```bash
   npm run dev
   ```

---

## 🏛️ Estrutura de Governança (RBAC)

O SisEscala utiliza uma hierarquia de acesso rigorosa via **Row Level Security (RLS)**:

- **Super Admin**: Acesso total ao sistema, configurações estruturais e gestão de usuários.
- **Admin**: Gerencia unidades e setores específicos vinculados ao seu perfil.
- **Coordenador**: Elabora escalas, aprova trocas e valida a presença dos servidores.
- **Servidor**: Acesso restrito ao Portal do Servidor para consulta e solicitações de troca.

---

## 📦 Versionamento e Ciclo de Releases

A partir do lançamento da versão **V1.0.0**, o SisEscala adota uma política estrita de versionamento semântico para ambientes de produção e homologação:
- **Versão Estável**: Indicada por `vX.Y.Z` (ex: `v1.0.0`, `v1.1.0`). Considerada pronta e testada para uso real em produção.
- **Ciclo de Homologação (RC)**: Modificações, melhorias e correções incrementais passarão por homologação usando sufixos `RC` (Release Candidate) antes de serem consolidadas como estáveis (ex: `v1.0.1RC`, `v1.0.1RC-1`, `v1.0.1RC-2`).
- **Nomenclatura**: A designação `Beta` deixa de ser utilizada no escopo de produção.

---

## 📄 Licença

Este projeto é privado e de uso exclusivo da **Secretaria Municipal de Saúde de Marabá (DMAC)**. Todos os direitos reservados.

---
**Desenvolvido por:** [Fernando Marculino](https://github.com/fmarculino) & Antigravity AI.
