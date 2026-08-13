# Reclassificar passo de presença na Folha de Ponto — 12/08/2026

## Contexto

Print de produção da Folha de Ponto de agosto/2026 de um coordenador de TI mostrou o dia 12
com entrada 08:05 e uma batida real das 21:09 caindo em **"SAÍDA INT."** em vez de **"SAÍDA"**.
O usuário pediu uma ferramenta de arrastar-e-soltar, só na tela da Folha de Ponto, pra mover
essa batida pro campo certo — com a condição explícita de que a correção refletisse também na
grade da escala, não só na folha.

## Diagnóstico

A unidade SMS tem `permite_marca_intervalo = true` (uma nota anterior do CLAUDE.md dizia
`false` — estava desatualizada) com jornada de 2h de intervalo previsto. O servidor trabalhou
direto no dia, sem marcar o intervalo. `fn_confirmar_presenca` (o terminal) não sabe que uma
batida é a *última* do dia — ela só preenche o próximo passo vazio em sequência (entrada →
saída intervalo → retorno intervalo → saída), então a segunda batida do dia sempre cai no
passo 2, mesmo sendo na prática a saída final. Confirmado em produção:
`escala_diaria.presenca_intervalo_saida_em = 21:09:58` (com segundos — batida real, não
sintética), `presenca_saida_em = NULL`.

Não é um bug isolado — é uma limitação inerente do modelo de 4 passos sequenciais quando o
servidor não segue a sequência esperada naquele dia.

## Por que é permitido e seguro

- `marcacoes_ponto` (a batida real, imutável) nunca é tocada — só se corrige em qual dos 4
  campos de `escala_diaria` aquele horário real está classificado. Não fabrica horário nenhum.
- Juridicamente equivalente ao que "Seleção da batida real" (v1.26.0) já faz — mover um
  horário real entre passos é tratamento autorizado pelo Art. 82, parágrafo único, quando feito
  com justificativa e rastro de auditoria.
- **A folha já tinha uma capacidade parecida, e ela era pior**: `handleCellChange`
  (`FolhaPontoEditor.tsx`) permite `super_admin` digitar por cima de uma célula
  `origem = 'real'`, mas isso perde a marca de "real" e `salvarFolhaPonto` só escreve em
  `folha_ponto.registros` — nunca em `escala_diaria`. A grade e o motor de compliance
  continuavam vendo o dado errado. A ferramenta nova corrige as duas coisas.

## O que foi construído

| peça | onde |
|---|---|
| RPC que move o horário entre passos | `fn_reclassificar_passo_presenca` (migration `20260812150000`) |
| Server Action | `reclassificarPassoPresenca` (`folha-ponto/actions.ts`) |
| Resolução de qual `escala_diaria.id` corrigir | `resolverMarcacaoDoDia` (`origemMarcacao.ts`), estendida para devolver também o `id` da linha vencedora |
| UI de arrastar-e-soltar + modal de justificativa | `FolhaPontoEditor.tsx` |

### `fn_reclassificar_passo_presenca`

Função nova e pequena — **não mexe em nenhuma das funções de 1000+ linhas**
(`fn_confirmar_presenca*`, armadilha 1 do CLAUDE.md), não precisou do script gerador. Recebe
`escala_diaria_id`, passo de origem, passo de destino e justificativa. Valida:

1. Passos são um dos 4 válidos e diferentes entre si; justificativa tem 5+ caracteres.
2. **Guard de escopo dentro da própria função** — não só na Server Action. Mesma lição já
   aplicada nesta sessão em `fn_blocos_previstos_dia`: uma RPC `GRANT`ada a `authenticated` é
   alcançável direto por REST, então a Server Action sozinha não basta. O guard replica
   exatamente a semântica de `hasSectorAccess` (`src/utils/permissions.ts`).
3. O passo de origem tem valor **e** não é `manual` (`presenca_<passo>_manual = false`) — só
   move batida real, nunca um valor já digitado. Quem já digitou continua corrigindo do jeito
   que já existe (digitar por cima).
4. O passo de destino está **vazio** — v1 não faz swap.
5. Move os 4 campos-irmãos (`_em`, `_manual`, `_origem`, `_marcacao_id`) da origem pro destino,
   limpa a origem.

### Server Action

Resolve qual `escala_diaria.id` corrigir usando a MESMA lógica que a folha já usa pra decidir o
que mostrar (`resolverMarcacaoDoDia`) — importante porque um dia pode ter mais de um turno
(Regular + Extra/Plantão), e corrigir a linha errada seria pior que não corrigir nada. Depois
de mover, chama `sincronizarFolhaPonto` (já existente) pra fechar o loop: a folha reflete a
correção sem precisar de um clique separado em "Sincronizar", sem duplicar lógica de geração.
Audita via `registrarLog`/`calcularAlteracoes` (`PRESENCA_RECLASSIFICADA`).

### Frontend

Drag-and-drop nativo HTML5 (sem biblioteca nova) nas 4 células de presença da Folha de Ponto.
Só arrastável quando `origem = 'real'` e o usuário tem papel de coordenação
(`coordenador`/`admin`/`super_admin`/`rh`/`rh_unidade`); só solta em célula vazia do **mesmo
dia**. Ao soltar, abre modal pedindo justificativa (mín. 5 caracteres) antes de confirmar.

## Fora de escopo (v1, deliberado)

- Soltar em cima de um passo já preenchido (swap).
- Mover entre dias diferentes.
- Mover entre turnos/categorias diferentes do mesmo dia (`escala_diaria.id` diferentes).
- Portal do Servidor.
- Reclassificar um valor já `manual` (continua editável do jeito que já existe hoje).

## Verificação

- `npx tsc --noEmit` e `npm run build` limpos.
- **Migration não aplicada nesta sessão** — usuário aplica em homologação e depois produção,
  como de praxe neste projeto.
- Teste real recomendado após aplicar: o próprio dia 12/08/2026 do coordenador de TI —
  arrastar a batida de "SAÍDA INT." pra "SAÍDA" e conferir que (1) `escala_diaria` atualiza,
  (2) a folha mostra o horário certo, ainda verde (real), sem precisar sincronizar manualmente,
  (3) a grade da escala (`ScaleGrid`) do dia reflete a mudança, (4) `logs_sistema` tem a linha
  `PRESENCA_RECLASSIFICADA` com a justificativa.
