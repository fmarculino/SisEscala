# Documentação de Evolução - Versão 1.12.0 (2026-07-23)

## 📋 Resumo Executivo

A versão **1.12.0** traz o **Módulo de Solicitações de Férias e Licenças**, o **Gerenciamento de Dados Complementares dos Servidores**, melhorias substanciais no **Portal do Servidor para Consulta e Trocas de Plantão** e rotinas server-side para **Processamento e Fechamento da Folha de Ponto**.

Dentre as principais novidades destaca-se o componente de **Impressão Timbrada de Requerimentos (`RequerimentoPrintView`)**, que gera formulários físicos/PDFs oficiais no padrão da Prefeitura Municipal de Marabá e Secretaria Municipal de Saúde para formalização jurídica de afastamentos de servidores.

---

## 🎯 Principais Funcionalidades & Implementações

### 1. Módulo de Solicitações de Férias e Licenças (`/ferias-licencas`)
- **Tabela Relacional & Migration (`public.solicitacoes_ferias_licencas`)**:
  - Nova migration Postgres (`20260724000000_add_solicitacoes_ferias_licencas.sql`) implementando tabela dedicada para registro de solicitações com chaves estrangeiras para servidor e unidade, enum de tipos (Férias, Licença Prêmio, Licença Médica/Atestado, Maternidade, Paternidade, Outros) e status da tramitação (*Pendente*, *Aprovada*, *Indeferida*, *Cancelada*).
- **Server Actions e Gestão Operacional**:
  - Ações server-side em `src/app/(dashboard)/ferias-licencas/actions.ts` para criação, listagem, homologação/aprovação e indeferimento de solicitações.
  - Sincronização automática com a agenda de escalas e afastamentos do servidor.
- **Componente de Impressão Timbrada (`RequerimentoPrintView.tsx`)**:
  - Emissão de documento oficial pronto para impressão ou salvamento em PDF.
  - Exibição de cabeçalho institucional timbrado (Prefeitura de Marabá / Secretaria Municipal de Saúde), dados funcionais completos do servidor, especificação do tipo e período do afastamento com contagem exata de dias corridos, campos formatados para assinatura do servidor, parecer da chefia imediata e decisão do setor de RH.

### 2. Dados Complementares dos Servidores (`/servidores`, `DadosComplementaresModal.tsx`)
- **Ficha Cadastral Estendida (`public.servidores_dados_complementares`)**:
  - Tabela de dados suplementares integrada ao cadastro principal do servidor via relacionamento 1:1.
- **Formulário de Informações Bancárias & Documentação**:
  - Suporte completo a dados de pagamento (Banco, Código da Instituição, Agência, Conta, Tipo de Conta e Chave PIX).
  - Controle de PIS/PASEP, Título de Eleitor (Zona e Seção Electoral), número de inscrição em Conselho de Classe profissional (CRM, COREN, CRF, etc.) com UF expedidora.
  - Endereço residencial completo e cadastro de contatos de emergência (Nome do contato, Parentesco/Vínculo e Telefone de Urgência).

### 3. Portal do Servidor & Consulta de Escala (`ConsultarEscalaClient.tsx`)
- **Consulta Autenticada por PIN / CPF / Matrícula**:
  - Interface do portal do servidor (`/consultar-escala`) desacoplada para renderização no cliente (`ConsultarEscalaClient`), oferecendo experiência fluida e responsiva para consulta individual de escalas e espelhos de frequência.
- **Trocas de Plantão e Permutas via Portal**:
  - Ações server-side (`src/app/consultar-escala/actions.ts`) permitindo que o servidor solicite trocas de plantão diretamente pelo portal mediante confirmação de seu PIN de segurança, selecionando o colega substituto e informando a justificativa.
- **Conferência em Tempo Real**:
  - Visualização gráfica da folha de ponto mensal com contagem de turnos normais, plantões extras e sobreavisos prestados.

### 4. Processamento Server-Side de Folha de Ponto
- **Automação de Folha e Gestão por Unidade (`UnitClient.tsx`)**:
  - Refatoração dos fluxos de processamento em `/folha-ponto` com server actions dedicadas para cálculo em lote, verificação de totais de horas normais/extras e controle de status de fechamento por setor/unidade.

---

## 🛠️ Arquivos Criados & Alterados

- `[NEW]` [supabase/migrations/20260724000000_add_solicitacoes_ferias_licencas.sql](file:///c:/Users/ferna/projetos/SisEscala/supabase/migrations/20260724000000_add_solicitacoes_ferias_licencas.sql)
- `[NEW]` [src/components/RequerimentoPrintView.tsx](file:///c:/Users/ferna/projetos/SisEscala/src/components/RequerimentoPrintView.tsx)
- `[NEW]` [src/app/(dashboard)/ferias-licencas/page.tsx](file:///c:/Users/ferna/projetos/SisEscala/src/app/(dashboard)/ferias-licencas/page.tsx)
- `[NEW]` [src/app/(dashboard)/ferias-licencas/actions.ts](file:///c:/Users/ferna/projetos/SisEscala/src/app/(dashboard)/ferias-licencas/actions.ts)
- `[NEW]` [src/app/consultar-escala/ConsultarEscalaClient.tsx](file:///c:/Users/ferna/projetos/SisEscala/src/app/consultar-escala/ConsultarEscalaClient.tsx)
- `[NEW]` [src/app/consultar-escala/actions.ts](file:///c:/Users/ferna/projetos/SisEscala/src/app/consultar-escala/actions.ts)
- `[NEW]` [docs/evolucao/2026-07-23-solicitacoes-ferias-licencas-dados-complementares-e-portal-v1.12.0.md](file:///c:/Users/ferna/projetos/SisEscala/docs/evolucao/2026-07-23-solicitacoes-ferias-licencas-dados-complementares-e-portal-v1.12.0.md)
- `[MODIFY]` [package.json](file:///c:/Users/ferna/projetos/SisEscala/package.json)
- `[MODIFY]` [README.md](file:///c:/Users/ferna/projetos/SisEscala/README.md)
- `[MODIFY]` [CHANGELOG.md](file:///c:/Users/ferna/projetos/SisEscala/CHANGELOG.md)
- `[MODIFY]` [src/app/(dashboard)/servidores/_components/DadosComplementaresModal.tsx](file:///c:/Users/ferna/projetos/SisEscala/src/app/(dashboard)/servidores/_components/DadosComplementaresModal.tsx)
- `[MODIFY]` [src/app/(dashboard)/folha-ponto/actions.ts](file:///c:/Users/ferna/projetos/SisEscala/src/app/(dashboard)/folha-ponto/actions.ts)
