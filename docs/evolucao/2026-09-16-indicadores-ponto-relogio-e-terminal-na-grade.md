# Indicadores de Ponto (Relógio e Terminal) na Grade de Escala (16/09/2026, v2.65.0)

**Arquivos:** 
- `src/app/(dashboard)/escalas/unidade/[unidadeId]/repStatusActions.ts` (novo)
- `src/app/(dashboard)/escalas/unidade/[unidadeId]/IndicadoresPontoServidor.tsx` (novo)
- `src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx` (modificado)
- `src/app/(dashboard)/escalas/unidade/[unidadeId]/page.tsx` (modificado)
- `src/app/(dashboard)/ajuda/conteudo/escalas.ts` (modificado)
- `src/app/(dashboard)/ajuda/conteudo/ponto.ts` (modificado)

---

## 1. Contexto e Necessidade

Ao montar a escala de trabalho, coordenadores e equipes de RH frequentemente precisam saber se os servidores escalados estão prontos para bater ponto:
1. **No Relógio Biométrico (REP):** O servidor está cadastrado no relógio físico que atende o setor? Ele já compareceu para cadastrar sua digital (biometria), ou está alocado mas sem biometria coletada?
2. **No Terminal Local / Web:** O servidor possui PIN de acesso cadastrado para registrar presença via tela/terminal da unidade?

Antes desta melhoria, para obter essas respostas o gestor precisava sair da grade de escala, navegar até **Configurações > Dispositivos REP**, abrir os detalhes de cada equipamento, ou consultar individualmente o cadastro do servidor em **Servidores > Perfil**. 

Isso gerava surpresas operacionais: escalas montadas com servidores que chegavam para o plantão e descobriam na hora que não conseguiam bater ponto no relógio por falta de biometria ou que não tinham PIN para o terminal.

---

## 2. O Desenho da Solução

Foram adicionados dois ícones compactos na primeira coluna da grade ("Servidor"), estrategicamente posicionados ao lado do botão de excluir servidor (`Trash2`) e logo abaixo do cargo e matrícula:

1. 🕒 **Relógio (`Clock`)**: Indica a prontidão do servidor em relação aos **Relógios Biométricos (REP)** da unidade/setor.
2. 💻 **Computador (`Monitor`)**: Indica a prontidão do servidor em relação aos **Terminais de Presença** da unidade.

### Sistema de Cores e Semântica

- 🟢 **Verde (`status: 'ok'`):**
  - **Relógio:** O servidor está alocado em pelo menos um relógio REP daquele setor/unidade E já possui biometria cadastrada (`tem_biometria = true`).
  - **Terminal:** O servidor possui PIN de acesso ativo e pronto para uso nos terminais disponíveis.
- 🟡 **Amarelo / Âmbar (`status: 'atencao'`):**
  - **Relógio:** O servidor está alocado no relógio físico, porém **falta cadastrar a biometria** (`tem_biometria = false`). O coordenador sabe que o servidor precisa ir ao equipamento coletar a digital antes de poder registrar ponto físico.
- 🔴 **Vermelho (`status: 'erro'`):**
  - **Relógio:** O servidor **não está alocado** em nenhum relógio REP do setor/unidade.
  - **Terminal:** O servidor **não possui PIN** cadastrado no sistema.
- ⚪ **Cinza (`status: 'sem_relogios'` / `'sem_terminais'`):**
  - A unidade/setor não possui relógios físicos ou terminais instalados.

### Balão de Informações (Popover)

Ao passar o mouse (`hover`) ou focar/clicar nos ícones:
- Abre-se um balão explicativo detalhado e elegante.
- Para o **Relógio**: Mostra o resumo e a lista nominal de cada relógio em que o servidor está alocado, destacando se a digital está cadastrada ou pendente por relógio.
- Para o **Terminal**: Mostra o status do PIN (se configurado) e lista os nomes dos terminais físicos/web ativos na unidade.

---

## 3. Desafios Técnicos Superados

### 3.1. RLS em `rep_usuarios_dispositivo`
A tabela `rep_usuarios_dispositivo` armazena o vínculo de cada servidor com cada relógio físico e a flag `tem_biometria`. Suas políticas de segurança (RLS) são restritas a `super_admin` e `admin`. Quando um Coordenador ou RH da Unidade visualizava a escala, consultas normais via `createClient()` retornavam 0 linhas.
- **Solução:** O helper `buscarStatusPontoServidores` utiliza `createAdminClient()` (service_role) para buscar com eficiência os metadados de biometria e terminais. Essa chamada ocorre com segurança no contexto da página da grade (`page.tsx`), que já valida as permissões de acesso à unidade e ao setor através de `hasUnitAccess` e `hasSectorAccess`.

### 3.2. Contexto de Empilhamento CSS (Sticky Columns)
Na grade de escala (`ScaleGrid.tsx`), tanto a coluna 0 ("Servidor") quanto a coluna 1 ("Tipo") são fixas com `sticky left-0` e `sticky left-[150px]`, ambas com `z-10`. Como a coluna 1 é renderizada posteriormente no DOM, o balão do popover ao se projetar para a direita era cortado pela coluna 1.
- **Solução:** Foi aplicado `hover:z-30 focus-within:z-30` na célula do servidor, garantindo que ao passar o mouse ou clicar no ícone, a célula do servidor se sobreponha temporariamente às colunas adjacentes.

### 3.3. Zero Flicker no Carregamento
Os status de ponto de todos os servidores da grade são pré-carregados no servidor (`page.tsx`) em lote e injetados via prop `statusPontoInicial` no `ScaleGrid`. Assim, os ícones já aparecem com suas respectivas cores no primeiro frame de renderização, sem loading spinners ou pulos visuais. Quando um servidor externo é adicionado dinamicamente à grade, uma busca pontual (`buscarStatusPontoServidor`) atualiza o mapa reativo.
