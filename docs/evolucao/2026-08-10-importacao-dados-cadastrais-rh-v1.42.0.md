# v1.42.0 — Importação dos dados cadastrais de RH (SFPRC01M)

**Data:** 10-11/08/2026
**Estudo:** [`docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md`](../planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md)
**Plano:** [`docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md`](../planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md)

---

## O que motivou

Um relatório de RH (`SFPRC01M`, julho/2026) com 9.763 vínculos empregatícios da SMS chegou pra
avaliação: dava pra usar isso pra alimentar o cadastro do SisEscala e reduzir digitação? O estudo
mediu o tamanho do problema antes de qualquer código: o SisEscala cobria **191 das ~3.382 pessoas
(5,6%)** que aparecem como vínculo ativo nesse relatório.

O arquivo também revelou dois padrões que o cadastro atual não modelava:

- **110 CPFs com dois vínculos ativos simultâneos de verdade** — a mesma pessoa em dois
  cargos/matrículas ao mesmo tempo (o cenário que o usuário descreveu: enfermeira num turno,
  médica noutro).
- **1.611 dos 6.526 CPFs distintos do arquivo (25%) têm mais de um registro ao longo do tempo** —
  853 mudaram de cargo entre os registros, 960 de lotação. Histórico de carreira real, não ruído
  de exportação.

## Decisões tomadas, e uma revertida no meio do caminho

| decisão | escolha | por quê |
|---|---|---|
| Modelar pessoa vs. vínculo | manter 1 linha = 1 vínculo em `servidores`, relaxar a unicidade de CPF | separar pessoa de vínculo é a refatoração correta a longo prazo, mas grande demais pra entrar como efeito colateral de uma importação — mexeria em escala, ponto, folha, terminal e portal inteiros |
| Cargo por regime (`TEC.ENFERM.` × `TEC.ENFERM_CONTRATADO`) | **manter separado** | primeira leitura minha foi "duplicidade, normalizar". O usuário corrigiu: é organização própria do RH pra diferenciar efetivo de contratado, não erro — decisão revertida antes de qualquer migration de fusão ser aplicada |
| Departamentos sem unidade correspondente (105 de 121) | **nenhuma unidade nova criada** | primeira proposta minha era criar todas (incluindo Câmara, Fórum, escolas cedidas). O usuário recusou: fabricar cadastro estrutural sem revisão individual não é o caminho — ficam pendentes, unidade em branco, decisão de cada um quando alguém for completar o cadastro |
| `Lotação`/`CodLotacao` | é o bloco de financiamento do SUS (18 valores), não a unidade física | confirmado pelo usuário — quem indica a unidade é `Departamento` |

O padrão nas duas reversões: minha primeira leitura tratava como "problema a resolver" algo que
era, na verdade, informação ou cautela intencional. Vale registrar para não repetir o erro.

## O que foi construído

**Schema** (7 migrations, `20260810110000`–`20260810170000`):
`financiamento_saude_blocos` (dicionário, 18 valores) · `cargos_codigos_origem` (código do RH →
cargo, sem fusão) · `servidores_historico_vinculo` (carreira, ancorada por **CPF**, não por
`servidor_id` — a matrícula muda, o CPF não) · relaxamento de `servidores_cpf_unico` com gate de
confirmação explícita (`vinculo_multiplo_confirmado`) em vez de bloqueio automático de banco ·
`status` ganha `Afastado` · `importacao_rh_pendentes` + `fn_promover_pendencia_rh` (staging — nada
vira `servidores` sem setor confirmado por humano) · 12 cargos que faltavam no dicionário.

**O trade-off que merece registro tão explícito quanto uma migration:** derrubar
`servidores_cpf_unico` abre mão do "backstop que sobrevive a um INSERT pelo SQL editor" que
justificou criar aquele índice em primeiro lugar (`20260809110000`). A rede que sobra é
`fn_possiveis_duplicidades_servidor` — diagnóstico, revisão humana periódica, não bloqueio
automático. Foi a troca aceita para não embarcar numa refatoração de pessoa-vs-vínculo dentro
desta importação.

**Scripts** (`scratchpad/rh_*.js`, seguem o padrão do projeto: propõem, humano revisa, só depois
aplicam):
- `rh_csv_utils.js` — parser + correção de mojibake (ver achado abaixo).
- `rh_mapear_unidades.js` — Departamento → unidade por similaridade de palavras (Jaccard sobre
  tokens, com lista de stopwords ajustada depois de dois falsos positivos: "Câmara Municipal"
  quase casou com "Hospital Municipal" só por `MUNICIPAL`, e "Almoxarifado Central" com o LACEM
  só por `CENTRAL`).
- `rh_normalizar_cargos.js` — hoje só lista os códigos sem cargo (a fusão foi revertida).
- `rh_importar.js` — classifica cada vínculo ativo em atualizar / novo resolvido / novo pendente /
  ambíguo, com `--simular`/`--aplicar` (simula por padrão, mesmo espírito de
  `fn_expurgar_logs(p_simular)`).

**UI:** `/servidores/pendencias` ganhou a seção "Importados aguardando cadastro" — busca, filtro,
formulário de conclusão (unidade → setor → cargo) chamando `fn_promover_pendencia_rh`, com o mesmo
gate de vínculo adicional do formulário de servidor.

## Dois achados durante a execução, não previstos no plano

**Mojibake inconsistente no CSV.** Não era corrupção uniforme — `Bairro` tinha 4.360 ocorrências,
`Nome` só 1 (mas incluindo um nome de servidor de verdade: `PAIXÃƒO` → `PAIXÃO`). Corrigir o
arquivo inteiro de uma vez (reinterpretar tudo como Latin-1) introduzia caractere de substituição
em campo que já estava certo — testado, 1.194 ocorrências. A correção foi por valor: só mexe onde
a assinatura do problema aparece, decodifica via CP-1252 (não só Latin-1 — um caso via
`SERVIÃ‡OS` só resolvia com a tabela CP-1252, não com a reversão simples), só aceita se não
introduzir caractere de substituição. Sem isso, nome, bairro e endereço de gente real teriam sido
gravados corrompidos em produção.

**PIS/PASEP sem validação de dígito no script de backfill.** A primeira rodada de `--aplicar`
estourou no meio: `chk_servidores_pis_digito` (existente desde v1.38.0) recusou um PIS inválido
que o script tentava gravar — o `CHECK` fez exatamente o que deveria, mas o certo era o script não
tentar mandar um PIS que ele já sabia ser inválido. Corrigido pra validar (`validarPis`, mesma
fonte única de `src/utils/documentos.ts`) antes de incluir no patch de backfill.

Nenhum dos dois chegou a corromper produção — o segundo porque a constraint do banco segurou antes
de qualquer escrita, o primeiro porque foi pego na revisão antes do `--aplicar`.

## Resultado da carga (10/08/2026)

| | |
|---|---|
| Servidores existentes que ganharam PIS/PASEP (era 0% preenchido) | **117** |
| Servidores existentes atualizados (algum campo complementar) | 116 |
| Vínculos novos na fila de pendências | 3.362 |
| ...com unidade já resolvida | 2.077 |
| ...aguardando unidade (nenhuma criada automaticamente) | 1.285 |
| ...vínculo adicional de CPF já presente (não é duplicata) | 206 |
| Linhas de histórico de carreira gravadas | 4.942 |
| Casos ambíguos (matrícula não bate com nada — decisão manual) | 6 |
| Servidores em `servidores` antes/depois da carga | 191 / 191 (a carga só alimenta a fila; ninguém entra direto) |

Um dos 6 ambíguos (LUCILIA LIMA AZEVEDO) foi esclarecido pelo usuário durante a revisão: o CPF que
está em produção (`60230746268`) já é o correto — a ambiguidade não é de CPF, é de matrícula (ela
tem 3 matrículas diferentes em jogo entre o SisEscala e os dois vínculos do CSV, nenhuma batendo
com nenhuma outra). Fica pendente de revisão manual, sem nada tocado automaticamente.

## O que fica pendente, fora deste plano

- Completar os 3.362 cadastros pendentes pela tela nova — trabalho contínuo dos administradores,
  não mais scriptado.
- Resolver os 6 ambíguos, um a um.
- Telefone dos cadastros novos: o CSV não tem (0% preenchido) — coleta manual à parte.
- Manter `servidores_historico_vinculo` atualizado quando cargo/unidade mudar pelo próprio
  SisEscala dali pra frente (hoje só tem o backfill desta carga) — precisaria de trigger, símile
  de `historico_transferencias`. Registrado como fase futura no plano, não bloqueia nada.
