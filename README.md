# SisEscala 📅[![Version](https://img.shields.io/badge/version-1.13.0-green.svg)](https://github.com/fmarculino/SisEscala)
[![Next.js](https://img.shields.io/badge/framework-Next.js%2015-black.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/backend-Supabase-green.svg)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/styling-Tailwind%20CSS-38B2AC.svg)](https://tailwindcss.com/)

O **SisEscala** é uma plataforma robusta de gestão de escalas de trabalho e controle de presença, projetada especificamente para atender às complexidades de órgãos públicos e unidades de saúde que operam em regime multi-setorial e multi-unidade.

O sistema foca em **governança, segurança jurídica e eficiência operacional**, automatizando desde a criação da escala até o processamento de trocas e auditoria de presença.

---

## 🚀 Principais Funcionalidades

### 📄 Ficha Cadastral em PDF, Webcam & Dados Bancários
- **Ficha Cadastral Timbrada (`FichaServidorPrintView.tsx`)**: Gerador de Ficha Cadastral em PDF/Impressão com timbre oficial da Prefeitura de Marabá / SMS, foto 3x4, dados funcionais/pessoais/bancários e assinaturas físicas e digitais do servidor e RH.
- **Captura via Webcam (`WebcamPhotoCaptureModal.tsx`)**: Captura de foto do servidor com câmera HTML5 em tempo real (1:1 crop, preview e refazer sem tela preta) e lightbox preview em alta resolução.
- **Dados Bancários Completos**: Seção dedicada para controle de Banco, Agência, Conta Corrente, Tipo de Conta e Chave PIX para folha de pagamento.
- **Importação CSV Inteligente (`/servidores/importar`)**: Leitor flexível com suporte a delimitadores `,` e `;`, modelo baixável `.csv` e mapeamento dinâmico de todas as colunas do servidor.

### 🏖️ Gestão de Férias, Licenças & Requerimentos Oficiais
- **Solicitações Digitais de Férias e Licenças (`/ferias-licencas`)**: Módulo dedicado para abertura, tramitação e aprovação de requerimentos de férias, licença prêmio, licença médica, entre outros.
- **Validação de Duplicidade & Rastreamento**: Trava de duplicidade para o mesmo exercício e histórico de solicitações indeferidas e contrapropostas deferidas no Painel de Alertas.

### 🔐 Autenticação, Segurança & Recuperação de Senha
- **Recuperação de Senha PKCE**: Fluxo seguro de recuperação de senha via e-mail utilizando PKCE (`/auth/callback` e `/resetar-senha`) integrado com Supabase Auth.
- **E-mail Institucional SMTP**: Disparo de e-mails corporativos via Google Workspace (`informatica.sms@maraba.pa.gov.br`) com layout oficial da Prefeitura de Marabá / Secretaria Municipal de Saúde (`/api/templates/recovery`).
- **Internacionalização de Erros**: Tradução automática de todas as mensagens de erro do Supabase Auth para Português amigável.

### 📋 Gestão de Escalas Inteligente
- **Auto-Escala Inteligente (Fase 1)**: Motor inteligente para preenchimento de escalas com base na continuidade histórica de folgas do mês anterior (ideal para 12x36), bloqueio automático de dias de afastamento (férias, licenças) e preferências de turnos cadastradas.
- **Automação de Competências & Cron**: Rotinas de fechamento automático de escalas vencidas e geração de folhas de ponto rascunho na virada do mês, com orquestração segura via endpoint `/api/cron` autenticado.
- **Filtros & Paginação de Alta Performance**: Visualização de escalas e folhas de ponto com paginação padrão (10 itens por página), busca textual e filtros refinados de Mês, Ano e Status (Previsão / Fechada, Status Escala, Status Folha).
- **Multi-categoria**: Suporte nativo para turnos **Regulares**, **Extras**, **Plantões** e **Sobreaviso**.
- **Templates Dinâmicos**: Aplicação rápida de padrões de escala (**12x36**, **5x2**, **6x1**) com um clique.
- **Detecção de Conflitos**: Motor de validação global que impede que um servidor seja escalado em dois locais ao mesmo tempo.
- **Horas Extras Virtuais**: Lançamento de horas extras numéricas (1h, 2h, etc.) sem geração de falsos positivos de conflito com a escala regular do servidor (como o turno normal MT).
- **Validação de Governança**: Restrição rígida por linha na grade de escala (Extra apenas na linha EXTRAS, Sobreaviso na linha SOBREAVISO) e bloqueio automático de horas extras diárias acima do limite legal de 2 horas.
- **Visualização Hierárquica de Setores**: Dropdowns de seleção de setores organizados em formato de árvore (ex: indentação de subsetores como a Enfermagem sob sua respectiva Ala), eliminando ambiguidades e facilitando a navegação.
- **Impressão de Escalas Otimizada**: Componente `ScalePrintView` integrado no portal de consulta para exportação direta em PDF e impressão das escalas mensais organizadas por unidade/setor, em conformidade com as exigências municipais.

### 📅 Gestão de Afastamentos & Eventos
- **Administração de Ausências**: Painel dedicado para cadastro de Férias, Atestados Médicos, Licenças Maternidade/Paternidade e Prêmio.
- **Sincronização com o Grid**: Regra automática que limpa turnos diários planejados concorrentes (sem presença confirmada) no período do evento, impedindo a alocação indevida de servidores afastados.

### ⚖️ Compliance Legal (Motor de Regras)
- **Validação de Interjornada**: Alerta automático para períodos de descanso inferiores a 11 horas.
- **Validação de DSR**: Controle de Descanso Semanal Remunerado (7+ dias de trabalho).
- **Segurança Jurídica**: Alertas visuais preventivos para o coordenador antes do fechamento da folha.

### 📊 Painel de Auditoria & Relatórios Diagnósticos
- **Comparativo Histórico em Tempo Real**: Gráfico no Painel de Controle com acompanhamento em tempo real das horas do mês vigente sem necessidade de fechamento formal da escala, escala vertical (Eixo Y), grade visual e cartões interativos de detalhamento por mês.
- **Relatórios Consolidados**: Relatórios de frequência de ponto, consolidados de horas extras, relatórios gerenciais de distribuição e conciliação por setores.
- **Dashboard de Performance**: Painel estatístico com gráficos dinâmicos de plantões extras e taxas de acionamento/resposta de sobreavisos por período, facilitando decisões de dimensionamento de pessoal pelo RH.
- **Filtros Modulares**: Sistema integrado de busca e refinamento por data, servidor, cargo, unidade e setor em todo o módulo de relatórios.

### 🔄 Portal do Servidor & Consulta de Escala (`ConsultarEscalaClient`)
- **Consulta Autenticada via PIN**: O servidor acessa sua escala individual e espelho de folha de ponto utilizando sua Matrícula/CPF e PIN individual de segurança.
- **Solicitação de Trocas de Plantão**: Fluxo interativo no portal para pedido de substituição/permuta com validação em tempo real e encaminhamento para aprovação da coordenação.
- **Notificações**: Status de solicitações (Aprovado/Rejeitado) visíveis instantaneamente no painel do servidor.

### 🕒 Controle de Presença (Ponto Digital)
- **Check-in/Check-out**: Registro de entrada e saída via PIN com geolocalização (GPS).
- **Frequência Inteligente para Horas Extras**: Registro unificado de check-in e check-out que calcula dinamicamente o fim do expediente somando a jornada regular do dia com as horas extras lançadas, gravando a presença em ambos os lançamentos (Regular e Extra) em uma única batida de ponto no terminal.
- **Janela de Tolerância**: Bloqueio de batidas fora do horário permitido para evitar fraudes.
- **Auditoria Forense**: Trilha de auditoria detalhada para todas as batidas e ajustes manuais.
- **Geolocalização em Setores com Fallback**: Configuração opcional de coordenadas geográficas (`latitude`, `longitude` e `raio_geofence`) específicas para setores físicos descentralizados. Quando não preenchida, o sistema herda automaticamente a geolocalização da unidade principal.

### ✈️ Gestão de Diárias e Pernoites (Planejado)
- **Deslocamento a Serviço**: Módulo desenhado para controle orçamentário e logístico de servidores que viajam com frequência (motoristas, TI, campanhas de saúde externa).
- **Cálculo Automático**: Aplicação de tabelas de reembolso diferenciadas por tipo de destino (Zona Rural, Vilas, Intermunicipal, Capital) e nível do cargo, com distinção entre diárias cheias (pernoite) e meia-diárias.
- **Prestação de Contas Integrada**: Fluxo de aprovação prévia com anexação posterior de relatórios e comprovantes diretamente no sistema.

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
