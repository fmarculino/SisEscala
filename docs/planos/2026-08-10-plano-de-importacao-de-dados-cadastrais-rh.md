# Importação dos dados de RH (SFPRC01M) — plano de execução

**Data:** 10/08/2026
**Estudo:** [`2026-08-10-estudo-importacao-dados-cadastrais-rh.md`](2026-08-10-estudo-importacao-dados-cadastrais-rh.md)
**Estado:** ✅ concluído (v1.42.0, 10-11/08/2026).

---

## Contexto

O estudo mediu o problema: o SisEscala cobre hoje **191 das ~3.382 pessoas** (5,6%) que aparecem
como vínculo ativo no CSV de RH da SMS. O arquivo tem 9.763 linhas — cada linha é um **vínculo**,
não uma pessoa: 110 CPFs têm 2 vínculos ativos simultâneos (a mesma pessoa em dois cargos/matrículas
ao mesmo tempo) e 1.611 CPFs (25%) têm histórico de mais de um vínculo ao longo do tempo (853
mudaram de cargo, 960 mudaram de lotação entre os registros — histórico de carreira real, não
ruído).

Decisões tomadas (10/08/2026):

1. `Lotação`/`CodLotacao` é mesmo o bloco de financiamento do SUS (confirmado).
2. Manter `servidores` como está (1 linha = 1 vínculo), relaxar a unicidade de CPF com uma
   confirmação explícita em vez de separar "pessoa" de "vínculo" numa refatoração grande.
3. ~~Normalizar cargo~~ — **revertido em 10/08/2026, depois de ver a proposta de fusão.** O
   sufixo de regime (`_CONTRATADO`) é organização própria do RH pra diferenciar efetivo de
   contratado, não duplicação por erro. Cargo mantém a separação da fonte: os 12 códigos que
   faltam viram cargos novos e distintos, nenhum se funde com o que já existe.
4. ~~Departamentos cedidos a outros órgãos viram unidade~~ — **revertido em 10/08/2026.** Criar
   ~105 unidades de uma vez (Câmara, Fórum, escolas, zona rural...) sem revisão individual seria
   fabricar cadastro estrutural sem necessidade real ainda. Só se usa `unidade_id` quando o
   `Departamento` bate com uma unidade **já cadastrada** (match exato ou provável, revisado à
   mão); o resto fica com `unidade_id` nulo — pendente — até um administrador precisar completar
   aquele cadastro e decidir (inclusive criando a unidade ali, se for o caso). Nenhuma unidade é
   criada por este projeto.
5. Efetiva/Estagiária não aparecem no CSV — assumido que este projeto simplesmente não alcança
   esses vínculos agora (lacuna de cobertura conhecida, não bloqueio).
6. Telefone dos cadastros novos fica pendente de coleta manual.

---

## O que já existe e é reaproveitado

- **`normalizarDoc` / `validarDocumentosServidor` / `erroDocumento`** (`src/utils/documentos.ts`) —
  mesma normalização/validação de CPF-PIS do resto do cadastro. Reaproveitado para normalizar o
  CPF do CSV (`padStart(11,'0')` antes de validar — armadilha 10 do CLAUDE.md).
- **`fn_cpf_ja_cadastrado`** (SECURITY DEFINER, `20260809110000`) — já devolve os vínculos
  existentes de um CPF. Muda o **uso** (de bloqueio automático para gate de confirmação), não a
  forma.
- **`fn_possiveis_duplicidades_servidor`** e a tela `/servidores/pendencias` (v1.39.0) — viram o
  lugar onde a importação expõe o que precisa de decisão humana.
- **`trg_atribuir_matricula_temporaria`** (`20260807110000`) — só age quando `matricula` vem
  vazia; o CSV sempre traz matrícula real, não interfere.
- **Upsert de `dicionario_setores` por nome** (`setores/actions.ts`) — mesmo mecanismo reaproveitado
  na promoção de pendências, para não duplicar entrada de setor.
- **`unidades`**: só `nome` é obrigatório para criar uma unidade — as unidades novas entram só com
  nome, com os defaults seguros que já existem para o resto.

**Não reaproveitado:** o fluxo `importServidores` (`servidores/importar/page.tsx`) — é tudo-ou-nada
e faz matching de unidade/setor só por igualdade exata de string, inviável para 3.492 vínculos com
121 nomes de departamento soltos. As peças (normalização, RPC de CPF) são reaproveitadas; a
orquestração não.

---

## Schema novo

| # | migration | o quê |
|---|---|---|
| 1 | `20260810110000_add_financiamento_saude_blocos.sql` | dicionário do bloco de financiamento do SUS (18 valores) + `servidores.financiamento_bloco_id` |
| 2 | `20260810120000_add_cargos_codigos_origem.sql` | mapeamento N:1 código do RH → cargo canônico |
| 3 | `20260810130000_add_servidores_historico_vinculo.sql` | histórico de carreira, append-only, ancorado por CPF |
| 4 | `20260810140000_relax_cpf_uniqueness_vinculo_multiplo.sql` | derruba o índice único de CPF, troca por gate de confirmação (`vinculo_multiplo_confirmado`) |
| 5 | `20260810150000_add_status_afastado_check.sql` | `status` ganha `Afastado` como valor real, com `CHECK` |
| 6 | `20260810160000_add_importacao_rh_pendentes.sql` | staging para vínculo novo sem cadastro completo |

Detalhe de cada uma nos próprios arquivos de migration (comentário de cabeçalho no padrão do
projeto). O trade-off da migration 4 (perder o backstop de banco contra CPF duplicado) está
documentado no cabeçalho dela e repetido aqui: a `UNIQUE` de CPF sobrevivia a um INSERT pelo SQL
editor; a gate de confirmação na action não. A rede que sobra é o diagnóstico
(`fn_possiveis_duplicidades_servidor`), que é revisão humana periódica, não bloqueio automático —
foi a troca aceita ao optar por manter 1 linha = 1 vínculo em vez de separar pessoa de vínculo.

---

## Scripts (propõem, humano confirma antes de aplicar — mesmo padrão dos `gen_*.js` do projeto)

- `scratchpad/rh_mapear_unidades.js` — cruza os 121 `Departamento` distintos contra as `unidades`
  existentes, gera proposta de mapeamento para revisão. **Só os matches contra unidade já
  cadastrada são usados**; os 105 "CRIAR_NOVA" não geram unidade — o vínculo entra pendente com
  `unidade_id` nulo.
- `scratchpad/rh_normalizar_cargos.js` — gerou proposta de fusão por regime, **descartada**
  (decisão 3 revertida). O que sobra útil deste script: a lista dos 12 códigos sem cargo, que
  agora viram cargo novo, um pra um, sem fusão.
- `scratchpad/rh_importar.js` — roda em modo simulação por padrão (`--simular`/`--aplicar`, mesmo
  padrão de `fn_expurgar_logs(p_simular)`); classifica cada vínculo ativo em atualizar / novo
  resolvido (unidade batida) / novo pendente (unidade não batida) / vínculo adicional, grava
  histórico completo por CPF.

---

## Fases de execução

1. ✅ Migrations do schema novo — aplicadas em produção em 10/08/2026.
2. ✅ Rodar os dois scripts de mapeamento — feito, revisado.
3. ✅ 12 cargos novos aplicados (`20260810170000`, sem fusão). Mapeamento de unidade usado como
   estava (só os 15 matches contra unidade existente) — nenhuma unidade nova criada.
4. ✅ `rh_importar.js --aplicar` rodado em 10/08/2026: 117 servidores ganharam PIS/PASEP, 3.362
   vínculos novos em `importacao_rh_pendentes` (2.077 com unidade resolvida), 4.942 linhas de
   histórico, 6 ambíguos (matrícula não bate com nada — decisão manual, nenhum tocado).
5. ✅ `/servidores/pendencias` ganhou a seção "Importados aguardando cadastro" (v1.42.0) — busca,
   filtro, formulário de conclusão chamando `fn_promover_pendencia_rh`.

### Pendente (fora deste plano, trabalho contínuo)

- Completar os 3.362 cadastros pendentes (setor sempre, unidade nos 1.285 sem match) — trabalho
  manual dos administradores pela tela nova, não mais scriptado.
- Resolver os 6 casos ambíguos (matrícula divergente) um a um.
- Telefone dos cadastros novos (decisão 6) continua sem fonte — coleta manual à parte.

---

## Verificação

- `npx tsc --noEmit` e `npm run build` a cada mudança de código.
- Scripts de mapeamento/importação rodam só leitura até a Fase 3/4 — autorização pedida antes de
  cada rodada que escreve.
- Pós-carga: contagem de `servidores` ativos antes/depois, contagem de `importacao_rh_pendentes`,
  amostra de `servidores_historico_vinculo`, e checagem de que `fn_possiveis_duplicidades_servidor`
  não aponta os pares de vínculo duplo confirmado como pendência.
