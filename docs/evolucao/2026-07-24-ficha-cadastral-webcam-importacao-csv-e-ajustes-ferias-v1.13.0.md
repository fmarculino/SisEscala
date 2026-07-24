# Documentação de Evolução - Versão 1.13.0 (2026-07-24)

A versão **1.13.0** traz a consolidação da **Ficha Cadastral do Servidor em PDF/Impressão**, a **Captura de Fotos via Webcam**, o suporte completo a **Dados Bancários para Folha de Pagamento**, a reformulação e ampliação da **Importação de Servidores via CSV (com delimitador flexível e modelo baixável)** e melhorias significativas de rastreamento no **Módulo de Férias e Licenças**.

---

## 🚀 Principais Recursos e Alterações

### 1. Ficha Cadastral do Servidor (Impressão Timbrada / PDF)
- **Componente FichaServidorPrintView (`FichaServidorPrintView.tsx`)**:
  - Formulário timbrado oficial em 4 blocos estruturados (Dados Pessoais, Dados Funcionais, Endereço & Contatos, Dados Bancários).
  - Inclui foto 3x4 do servidor, áreas reservadas para assinaturas físicas do servidor e da coordenação/RH, além de termo de responsabilidade institucional.
  - Carregamento da **logo oficial da Prefeitura Municipal de Marabá / SMS** a partir da chave global `instituicao_cabecalho_url`.
- **Botão de Impressão na Interface (`EditServidorForm.tsx`)**:
  - Adicionado o botão verde `📄 Imprimir Ficha Cadastral (PDF)` posicionado no lado direito do cabeçalho de abas do cadastro do servidor.

### 2. Captura de Foto do Servidor via Webcam & Preview High-Res
- **Captura via Webcam (`WebcamPhotoCaptureModal.tsx`)**:
  - Modal interativo com streaming HTML5 de câmera em tempo real, enquadramento 1:1, captura instantânea, preview e opção de refazer foto.
  - Resolução do problema de tela preta ao refazer a foto por meio da manutenção contínua da tag `<video>` no DOM React.
  - Fallback de upload direto de imagem caso a estação não possua webcam.
- **Lightbox / Preview da Foto (`PhotoPreviewModal.tsx`)**:
  - Modal em alta resolução exibido ao clicar no avatar do servidor, apresentando foto em destaque, matrícula, cargo e unidade.

### 3. Dados Bancários para Folha de Pagamento & Migração SQL
- **Seção de Dados Bancários (`DadosComplementaresSection.tsx`)**:
  - Adicionada a Seção **5. Dados Bancários (para Folha de Pagamento)** no formulário do servidor, contendo: Banco, Agência (Nº), Conta Corrente (Nº), Tipo de Conta e Chave PIX.
- **Migração de Banco de Dados (`20260724020000_add_dados_bancarios_to_servidores.sql`)**:
  - Inclusão das colunas `banco_nome`, `agencia_numero`, `conta_numero`, `conta_tipo` e `chave_pix` na tabela `public.servidores`.
- **Tratamento de Schema Cache e Fallback (`actions.ts`)**:
  - Atualização do `extractDadosComplementares` e mecanismo de resiliência em `updateServidor` para tratar inconsistências de cache do PostgREST sem travar o salvamento.

### 4. Importação de Servidores via CSV Ampliada (`/servidores/importar`)
- **Parser Flexível com Auto-Detecção (`actions.ts`)**:
  - Suporte automático a delimitadores por vírgula (`,`) e ponto e vírgula (`;` - padrão Excel PT-BR), além de tratamento de aspas e caracteres especiais.
  - Mapeamento dinâmico de cabeçalhos sem diferenciação de acentos ou maiúsculas (`normalizeCSVHeader`).
  - Suporte ao preenchimento de todos os campos básicos e complementares (CPF, RG, PIS, Nascimento, Mãe, Pai, Endereço, Banco, etc.).
- **Botão "Baixar Modelo CSV Exemplo" (`ImportarServidoresPage.tsx`)**:
  - Geração instantânea e download do arquivo `modelo_importacao_servidores.csv` pré-formatado com linha de exemplo para orientação dos usuários.

### 5. Férias e Licenças — Rastreamento de Indeferidos e Painel de Alertas
- **Validação de Duplicidade em Solicitações (`actions.ts`, `PortalFeriasLicencasSection.tsx`)**:
  - Bloqueio de novas solicitações para o mesmo exercício se houver solicitação ativa/deferida (`aguardando_validacao`, `deferido`, `contraproposta`), permitindo solicitações em exercícios distintos.
- **Visualização de Solicitações Indeferidas (`page.tsx`)**:
  - Ajuste na listagem para carregar solicitações de todos os status por padrão, mantendo solicitações indeferidas visíveis com badge em vermelho e destaque para o **❌ Parecer do Indeferimento** e data de avaliação.
- **Resumo Exato do Período no Painel de Alertas**:
  - Correção dos contadores da aba **Alertas** para registrar com exatidão **Pendentes**, **Deferidas**, **Indeferidas** e **Contrapropostas** (incluindo contrapropostas aceitas e deferidas).
- **Mapa da Programação Anual**:
  - Atualização da query em `getProgramacaoAnualSetor` para incluir solicitações de todos os status no mapa anual do setor.

---

## 🛠️ Arquivos Modificados / Criados

- `[NEW]` [supabase/migrations/20260724020000_add_dados_bancarios_to_servidores.sql](file:///c:/Users/Cliente/Projetos/SisEscala/supabase/migrations/20260724020000_add_dados_bancarios_to_servidores.sql)
- `[NEW]` [src/components/servidores/FichaServidorPrintView.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/components/servidores/FichaServidorPrintView.tsx)
- `[NEW]` [src/components/servidores/WebcamPhotoCaptureModal.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/components/servidores/WebcamPhotoCaptureModal.tsx)
- `[NEW]` [src/components/servidores/PhotoPreviewModal.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/components/servidores/PhotoPreviewModal.tsx)
- `[MODIFY]` [src/app/(dashboard)/servidores/actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/servidores/actions.ts)
- `[MODIFY]` [src/app/(dashboard)/servidores/[id]/EditServidorForm.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/servidores/[id]/EditServidorForm.tsx)
- `[MODIFY]` [src/components/servidores/DadosComplementaresSection.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/components/servidores/DadosComplementaresSection.tsx)
- `[MODIFY]` [src/app/(dashboard)/servidores/importar/page.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/servidores/importar/page.tsx)
- `[MODIFY]` [src/app/(dashboard)/ferias-licencas/page.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/ferias-licencas/page.tsx)
- `[MODIFY]` [src/app/(dashboard)/ferias-licencas/actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/ferias-licencas/actions.ts)
- `[MODIFY]` [src/app/consultar-escala/actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/consultar-escala/actions.ts)
- `[MODIFY]` [src/app/consultar-escala/PortalFeriasLicencasSection.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/consultar-escala/PortalFeriasLicencasSection.tsx)
- `[MODIFY]` [package.json](file:///c:/Users/Cliente/Projetos/SisEscala/package.json)
- `[MODIFY]` [CHANGELOG.md](file:///c:/Users/Cliente/Projetos/SisEscala/CHANGELOG.md)
- `[MODIFY]` [README.md](file:///c:/Users/Cliente/Projetos/SisEscala/README.md)
