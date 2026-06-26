# Evolução do Sistema: Implementação da Auto-Escala Inteligente (Fase 1) (v1.8.0)

Este documento registra o relatório de execução e o histórico das alterações implementadas no **SisEscala** em 25/06/2026.

---

## 1. Escopo das Alterações Concluídas

### 1.1 Migração do Banco de Dados
- **Implementação:** Desenvolvida a migração [20260626223500_add_preferences_and_hours_to_servidores.sql](file:///c:/Users/Cliente/Projetos/SisEscala/supabase/migrations/20260626223500_add_preferences_and_hours_to_servidores.sql).
- **Novas Colunas:** Adicionadas `preferenca_turno` (valores permitidos: `'M'`, `'T'`, `'N'`, `'Flexivel'`) e `carga_horaria_semanal` (inteiro) à tabela `public.servidores`.
- **Preenchimento Inicial Lógico:** 
  - Registros com vínculo `'Estagiária'` foram atualizados com `carga_horaria_semanal = 30`.
  - Registros com demais vínculos (`'Efetiva'`, `'Contratada'`, etc.) foram atualizados com `carga_horaria_semanal = 40`.

### 1.2 Motor de Escalas Inteligente
- **Implementação:** Desenvolvido o módulo utilitário [intelligentScaleGenerator.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/intelligentScaleGenerator.ts).
- **Histórico e Continuidade:** O motor busca as escalas diárias e mensais do mês anterior e detecta a escala 12x36 do servidor. Se ele trabalhou no último dia do mês anterior, inicia o novo mês em folga (dia 1). Se folgou, inicia trabalhando.
- **Integração com Afastamentos:** O motor consulta os afastamentos na tabela `servidores_eventos` para o mês alvo e limpa/zera automaticamente a escala sugerida nos dias em que há férias ou licenças ativas para o servidor.
- **Preferências de Turno:** O motor lê as preferências de turno cadastradas no perfil do servidor (ou o turno histórico mais utilizado no mês anterior) e o define como turno padrão a ser preenchido na linha Regular.

### 1.3 Integração da UI na Grade de Escalas
- **Implementação:** Integrado no componente [ScaleGrid.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx).
- **Botão "Gerador Inteligente":** Botão com destaque na cor Indigo/Roxa e ícone `Sparkles` animado inserido na toolbar da grade.
- **Modal de Configurações:** Modal que permite ao coordenador decidir se deseja respeitar a continuidade, desviar dos afastamentos e aplicar as preferências.
- **Rascunho Local (Draft):** A escala sugerida pelo motor é injetada na grade em memória para revisão e ajustes manuais do coordenador. O motor **nunca** sobrescreve dias com presença confirmada. A gravação no banco só ocorre após o clique em "Salvar Previsão".

### 1.4 Cadastro e Edição de Servidores
- **Formulários:**
  - Cadastro ([novo/page.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/servidores/novo/page.tsx)) e Edição ([EditServidorForm.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/servidores/[id]/EditServidorForm.tsx)) atualizados com campos de seleção para a preferência de turno e de número para a carga horária semanal.
- **Server Actions:**
  - Modificado o arquivo [actions.ts (servidores)](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/servidores/actions.ts) para capturar esses campos do `FormData` e enviá-los ao Supabase nas funções `createServidor` e `updateServidor`.

### 1.5 Ajuste de Filtro de Turnos no Template Modal
- **Melhoria:** O dropdown de turnos do modal "Aplicar Template" em [ScaleGrid.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx) foi filtrado para listar apenas turnos normais (`tipo` contendo `'Normal'`), ocultando plantões/extras virtuais, sobreavisos e outros registros inadequados para a linha Regular.

---

## 2. Inventário de Arquivos Modificados/Criados

```
├── docs/
│   ├── planos/
│   │   └── 2026-06-26-estudo-auto-escala-inteligente.md [NEW]
│   └── evolucao/
│       └── 2026-06-25-implementacao-auto-escala-inteligente-fase1.md [NEW]
├── src/
│   ├── app/
│   │   └── (dashboard)/
│   │       ├── escalas/
│   │       │   └── unidade/[unidadeId]/
│   │       │       └── ScaleGrid.tsx [MODIFY]
│   │       └── servidores/
│   │           ├── [id]/
│   │           │   └── EditServidorForm.tsx [MODIFY]
│   │           ├── novo/
│   │           │   └── page.tsx [MODIFY]
│   │           └── actions.ts [MODIFY]
│   ├── types/
│   │   └── database.ts [MODIFY]
│   └── utils/
│       └── intelligentScaleGenerator.ts [NEW]
├── supabase/
│   └── migrations/
│       └── 20260626223500_add_preferences_and_hours_to_servidores.sql [NEW]
├── CHANGELOG.md [MODIFY]
└── package.json [MODIFY]
```

---

## 3. Validação Executada
- **Compilação TypeScript:** Comando `npx tsc --noEmit` rodado com sucesso sem acusar nenhum erro de tipo.
- **Funcionamento Lógico:** Verificada a correta identificação do offset da escala 12x36 e a limpeza automática nos dias correspondentes aos afastamentos.
