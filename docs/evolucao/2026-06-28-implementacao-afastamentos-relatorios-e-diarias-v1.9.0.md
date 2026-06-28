# Relatório de Evolução - Versão v1.9.0 (28/06/2026)

Este documento resume as melhorias e novos módulos integrados ao **SisEscala** entre os dias 27 e 28 de junho de 2026, com foco em gestão de afastamentos, relatórios gerenciais/gráficos, impressão otimizada de escalas e o plano de diárias para viagens.

---

## 1. Impressão de Escalas Otimizada (`ScalePrintView`)

### Contexto & Necessidade
As escalas de serviço precisam ser impressas e assinadas fisicamente para fiscalização de órgãos de controle municipal. Anteriormente, a visualização em grade no navegador continha elementos interativos que dificultavam uma impressão limpa e bem diagramada em folhas A4 horizontais.

### O que foi feito
- Criação do componente especializado [ScalePrintView](file:///c:/Users/Cliente/Projetos/SisEscala/src/components/ScalePrintView.tsx).
- Integração da funcionalidade de impressão direta via CSS `@media print` no arquivo [ConsultarEscalaClient](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/consultar-escala/ConsultarEscalaClient.tsx), ocultando menus, botões de ação e aplicando dimensionamento adequado das tabelas de escalas para caber em papel A4 sem cortar dados.

---

## 2. Gestão de Afastamentos & Eventos

### Contexto & Necessidade
Quando um servidor entra em férias ou apresenta um atestado médico, o coordenador precisava remover manualmente os turnos agendados no período e lembrar de não escalá-lo novamente, gerando risco de erros.

### O que foi feito
- **Interface Administrativa:** Criação de tela dedicada para lançamento de afastamentos de servidores (Férias, Licenças, Atestado Médico).
- **Limpeza Automatizada:** Implementado gatilho no banco de dados (`fn_clean_conflicting_shifts`) que deleta automaticamente todas as escalas planejadas futuras e concorrentes do servidor (desde que sem presença confirmada) no momento em que o afastamento é cadastrado.
- **Validação Anti-Escala:** Atualização da função `fn_check_shift_conflicts` para rejeitar qualquer tentativa de agendamento de escala regular ou plantão extra nos dias cobertos pelo afastamento ativo do servidor.

---

## 3. Dashboard Gerencial & Filtros Modulares

### Contexto & Necessidade
Para otimizar o dimensionamento de servidores, a diretoria precisava de uma visão analítica sobre a quantidade de plantões extras gerados, tempo de resposta das equipes acionadas em sobreaviso, além de filtros detalhados nos relatórios para auditoria interna.

### O que foi feito
- **Gráficos de Performance:** Integração de dashboard analítico com gráficos interativos detalhando a evolução de plantões extras e taxas de aceitação/expiração de chamados de sobreaviso.
- **Sistema de Filtros Modulares:** Implementação de barra de busca avançada nos relatórios permitindo filtrar de forma combinada por período, servidor, cargo, unidade e setor (respeitando a indentação em árvore de subsetores).

---

## 4. Plano do Módulo de Diárias e Pernoites (Planejado)

### Contexto & Necessidade
Servidores que viajam constantemente a serviço (motoristas de ambulância, técnicos de TI em vilas/assentamentos rurais, equipes de saúde móvel) necessitam de controle rigoroso de diárias de viagem e reembolso de despesas com alimentação e hospedagem.

### O que foi feito
- **Estudo Técnico & Negócios:** Pesquisa sobre o padrão de concessão de diárias no setor público (SCDP) e regras de diária cheia (com pernoite) e meia-diária (sem pernoite).
- **Proposta Arquitetural:** Documentado o esquema relacional do banco de dados (tabelas de tarifas por cargo/destino, solicitações e fluxo de prestação de contas com upload de comprovantes) e a regra de sincronização com o grid de escalas (lançando automaticamente evento de "Viagem a Serviço" para bloquear conflitos).
- Documento centralizado em [docs/planos/2026-06-28-estudo-e-plano-diarias-pernoites.md](file:///c:/Users/Cliente/Projetos/SisEscala/docs/planos/2026-06-28-estudo-e-plano-diarias-pernoites.md) para apresentação à diretoria.
