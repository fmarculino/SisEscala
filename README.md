# SisEscala 📅[![Version](https://img.shields.io/badge/version-2.2.0-green.svg)](https://github.com/fmarculino/SisEscala)
[![Next.js](https://img.shields.io/badge/framework-Next.js%2015-black.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/backend-Supabase-green.svg)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/styling-Tailwind%20CSS-38B2AC.svg)](https://tailwindcss.com/)

O **SisEscala** é uma plataforma robusta de gestão de escalas de trabalho e controle de presença, projetada especificamente para atender às complexidades de órgãos públicos e unidades de saúde que operam em regime multi-setorial e multi-unidade.

O sistema foca em **governança, segurança jurídica e eficiência operacional**, automatizando desde a criação da escala até o processamento de trocas e auditoria de presença.

---

## 🚀 Principais Funcionalidades

### 📄 Verso da Folha de Ponto & Relatório Anexo de Plantão/Sobreaviso (v2.2.0)
- **Verso Oficial da Folha de Ponto**: Quadro analítico com detalhamento completo de ocorrências, justificativas registradas, atestados, declarações e histórico funcional para prestação de contas aos órgãos fiscalizadores.
- **Relatório Anexo de Plantão e Sobreaviso (`RelatorioPlantaoSobreavisoAnexo.tsx`)**: Relatório gerado em PDF/impressão consolidando plantões extras e escalas de sobreaviso cumpridas no mês, com cruzamento de justificativas de eventos e descrições do `dicionario_turnos`.
- **Acesso Seguro via Service Role**: Consultas administrativas de relatórios e anexos utilizando `createAdminClient` para evitar recortes indevidos de escopo RLS entre setores da mesma unidade.

### ⏱️ Afastamentos Fracionados (Por Horas) & Abono Parcial (v2.2.0)
- **Afastamento Fracionado (`tipo_periodo = 'horas'`)**: Permite cadastrar afastamentos com hora de início e término (`hora_inicio`, `hora_fim`), possibilitando abonar saídas antecipadas, consultas médicas ou convocações pontuais.
- **Cálculo Preciso de Horas**: Dedução proporcional das horas abonadas sem anular o restante do expediente trabalhado no dia, com integração automática na Folha de Ponto, Grade de Escalas e Portal do Servidor.

### 🕐 Reconciliação em Massa de Marcações REP & Duplo Vínculo (v2.2.0)
- **Resolução de Identidade com Escopo de Unidade**: `fn_servidor_por_identificador_afd` desfaz ambiguidades quando um mesmo CPF possui duplo vínculo funcional ativo no município, associando a batida à unidade correta do relógio.
- **Auto-Reconciliação Instantânea**: A ingestão de arquivos AFD do REP dispara automaticamente a reconciliação das marcações, atualizando o espelho de ponto em tempo real.
- **Reprocessamento Retroativo de Batidas Órfãs**: Rotina que recupera e vincula automaticamente marcações históricas do AFD assim que novos servidores são cadastrados ou vinculados.

### 🔄 Coletor REP v0.7.0 & Automação de Higiene
- **Higiene Automatizada em Background**: O ciclo do coletor (5 min) executa remoções pendentes no hardware REP e confirma a exclusão por relistagem sem exigir intervenção do usuário.
- **App de Bandeja (Tray) com Menu Completo**: Ações rápidas no Windows para sincronização forçada, disparo de rotina de higiene e status em tempo real.
- **CI/CD no GitHub Actions**: Pipeline automatizado que compila os binários Go para Windows e executa checagens estáticas de tipos e lint a cada push.

### ⚙️ Correções de Presença, Isolamento do Sobreaviso & Intervalo Flexível (v1.21.0)
- **Intervalo Flexível por Servidor**: nova flag no cadastro que libera o gozo do intervalo em **qualquer horário**, mesmo em unidades de intervalo **Rígido**, desde que a carga horária líquida seja cumprida. A saída passa a ser calculada dinamicamente (`fim previsto + excedente do intervalo`): jornada 08h–18h com 2h previstas, saindo 14h e voltando 17h, encerra às 19h.
- **Sobreaviso Isolado do Registro de Presença**: o sobreaviso deixa de ser fundido no bloco de trabalho contínuo, que travava a batida de saída do expediente. `Regular`, `Extra` e `Plantão` seguem fundindo entre si normalmente. O ciclo do sobreaviso (acionamento → aceite → chegada) permanece integralmente em `logs_sobreaviso`, com barreira definitiva no banco (`chk_sobreaviso_sem_presenca`).
- **Guard de Intervalo Intrajornada (CLT Art. 71)**: restaurada a proteção que impede jornadas de **4h e 6h** de receberem o fluxo de 4 batidas, o que fazia a saída real ser gravada como "saída para intervalo". Regra centralizada em `fn_jornada_tem_intervalo`, aplicada ao terminal, à marcação manual, à validação em massa e à grade de escala.
- **Recuperação de Batidas Recusadas**: saídas legitimamente registradas e recusadas por falha do sistema foram reconstruídas a partir de `logs_tentativas_presenca`, preservando o horário real da batida.

### ⚡ Correções de Cálculo do Turno T, Permissões RLS e Rótulos Dinâmicos (v1.19.1)
- **Cálculo da Hora de Início para Turno `T` (Jornadas 12h-18h)**:
  - Atualizadas as funções `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` para avaliar dinamicamente o `start_hour` da jornada regular (ex: 12:00) quando a célula possui o turno `T`, ajustando a janela de presença para **11:30 às 12:30**.
- **Visualização de Tentativas Recusadas para Gestores**:
  - Nova política de segurança RLS (`Allow authorized users read logs`) na tabela `logs_tentativas_presenca`, permitindo que **Coordenadores e Administradores** visualizem o quadro vermelho com os motivos de recusa no modal de validação manual.
- **Rótulos Dinâmicos do Escopo de Validação**:
  - Substituídos os sub-rótulos estáticos e enganosos `(Manhã)` e `(Tarde)` por descrições dinâmicas de acordo com o turno do servidor naquele dia (`Manhã`, `Entrada Tarde`, `Entrada Noturna`, `1º/2º Turno`), garantindo clareza nos modais.
- **Suporte aos Escopos de Validação Manual**:
  - Suporte completo aos parâmetros `'completo'`, `'periodo_1'`, `'periodo_2'` na RPC `fn_confirmar_presenca_manual`, eliminando o erro de *"Tipo de presença inválido"*.

### ⚡ Validação em Massa de Presença & Governança de Ajustes (v1.19.0)
- **Validação em Multi-Níveis**:
  - **Nível 1 (Por Célula / Meio Período)**: Ações rápidas no modal da célula para homologação de batidas individuais, dia completo, 1º período (Manhã) ou 2º período (Tarde).
  - **Nível 2 (Por Servidor)**: Atalho `<CheckSquare />` na grade para validação por intervalo de datas específico para um servidor.
  - **Nível 3 (Global por Unidade)**: Botão `⚡ Validar em Massa` no topo da grade para homologação global em lote de múltiplos servidores.
- **Preservação Integral das Batidas Reais de Servidores**: Atualização da função RPC `fn_confirmar_presenca_manual` com `COALESCE` em todas as etapas para que batidas efetuadas via relógio de ponto não sejam sobrescritas, preenchendo e sinalizando como ajustes manuais apenas os horários faltantes.
- **Justificativa Obrigatória & Validação Manual de Sobreaviso**: Exigência de justificativa cadastrada em banco de dados para qualquer homologação manual de presença ou sobreaviso pendente/falhado.
- **Nomenclatura Padrão ("PREVISÃO" / "PREV")**: Atualização da denominação da grade (`ScaleGrid.tsx`), relatórios consolidados e ajuda de `PLANEJADO` para `PREVISÃO`.
- **Alerta de Recusas pelo Terminal**: Leitura dos logs de tentativas negadas exibindo selo ⚠️ e tooltip explicativo.

### ⏱️ Controle de Marcação de Intervalos (Pausas) por Unidade
- **Modos Flexível & Rígido**: Escolha por unidade se o intervalo intrajornada é livre (Flexível) ou fixado por horários rígidos, em total conformidade com o Art. 71 da CLT e Portaria MTP 671/2021.
- **Cascata de Resolução Híbrida (Modo Rígido)**: Resolução de horários priorizando a personalização no servidor $\rightarrow$ padrão da jornada $\rightarrow$ cálculo automático.
- **Grade de Escala Dinâmica (2 vs 4 Segmentos)**: Exibição de 4 batidas presenciais (Entrada, Saída Intervalo, Retorno Intervalo, Saída Final) na grade de escala e folha de ponto.
- **Governança & Segurança Jurídica**: Trava de reversão em batidas reais de terminal físico (exclusivas para Administradores) e descarte automático de 4 passos para jornadas curtas ($\le$ 4h).

### 💬 Comunicação Unificada: WhatsApp (Multi-Provedor) & E-mail (SMTP)
- **Integração WhatsApp API Multi-Provedor**: Suporte nativo ao **AstraCalls API**, **Chatwoot API** e **API HTTP Genérica Customizada** (com template JSON de payload e headers flexíveis para conectar a qualquer gateway como Evolution API, Z-API, WPPConnect, etc.).
- **Fallback Inteligente de Contingência**: Transição automática ou assistida para **WhatsApp Web / App (`wa.me`)** caso ocorra qualquer instabilidade ou erro na API do WhatsApp.
- **Governança de Comunicação (`/configuracoes`)**: Painel visual de gestão de credenciais e parâmetros de WhatsApp e Servidor de E-mail (SMTP) armazenados em `configuracoes_globais`, com modais de teste em tempo real antes de salvar.
- **Notificação de Acionamento e PIN**: Envio automático de acionamentos de sobreaviso (`ScaleGrid.tsx`) e PIN de acesso do servidor (`/servidores`).
- **Aviso de Ponto por WhatsApp (Opt-in)**: O servidor escolhe receber um resumo diário ou semanal das próprias batidas — frequência limitada a esses dois modos para controlar o volume de mensagem enviado pelo número institucional.

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
- **Exclusão Restrita**: Remoção de afastamento cadastrado indevidamente, disponível para Administrador Geral, RH Geral e RH da Unidade.

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
- **Faltas Automáticas na Folha de Ponto (v2.0.0)**: Dia com turno previsto e nenhuma marcação (real ou manual) de entrada/saída vira pendência de justificativa e, se ninguém regularizar dentro do prazo configurável, falta definitiva — sem depender de alguém digitar "FALTA" na observação.

### 🕐 Relógio de Ponto Físico (REP)
- **Integração com Equipamento REP-C Certificado**: Coleta de AFD assinado (Portaria 671/2021) por sincronização online contínua ou por coletor local instalado na unidade.
- **Coleta e Cadastro por Pendrive (v2.0.0)**: Para unidades sem rede até o relógio — exportação/importação de marcações e, agora, de cadastro de identidade (`coletor-rep-cli cadastros-exportar`), no mesmo formato CSV que o próprio equipamento usa para importar por USB.
- **Higiene de Cadastros do Dispositivo**: Leitura de tudo que está cadastrado no relógio, com remoção segura (confirmada por relistagem) de quem sobrou de sistema anterior e não corresponde a nenhum servidor ativo.
- **Cobertura da Escala**: Painel que cruza quem está escalado com quem realmente consegue bater ponto no equipamento — identifica o caso silencioso de servidor cadastrado e com biometria, mas sem vínculo no SisEscala, cuja batida vira órfã sem ninguém perceber.
- **App de Bandeja para a Unidade**: Aplicativo local (`.exe`, auto-instalável, sem privilégio de administrador) que mantém o ciclo de sincronização rodando na máquina da unidade, com aviso de atualização disponível.

### ✈️ Gestão de Diárias e Pernoites (Planejado)
- **Deslocamento a Serviço**: Módulo desenhado para controle orçamentário e logístico de servidores que viajam com frequência (motoristas, TI, campanhas de saúde externa).
- **Cálculo Automático**: Aplicação de tabelas de reembolso diferenciadas por tipo de destino (Zona Rural, Vilas, Intermunicipal, Capital) e nível do cargo, com distinção entre diárias cheias (pernoite) e meia-diárias.
- **Prestação de Contas Integrada**: Fluxo de aprovação prévia com anexação posterior de relatórios e comprovantes diretamente no sistema.

## 🛠️ Stack Tecnológica


- **Frontend**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS](https://tailwindcss.com/)
- **Ícones**: [Lucide React](https://lucide.dev/)
- **Backend/Banco de Dados**: [Supabase](https://supabase.com/) (PostgreSQL + RLS + Auth), self-hospedado
- **Deployment**: [Coolify](https://coolify.io/) numa VPS própria — deploy automático a cada push na `main`

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
