# Integração com relógio de ponto — Fases 0 a 4

**Data:** 08/08/2026 · **Versão:** ainda não fechada (permanece 1.21.0 até a implementação terminar)

Registro da primeira sessão de implementação do plano
[`docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md`](../planos/2026-08-08-integracao-relogio-de-ponto-rep.md).
Onze migrations, todas **aplicadas em produção** nesta data.

---

## O que motivou

A SMS tem relógios de ponto Control iD REP iDClass parados. A ideia é usá-los como ponto de
coleta e fazer todo o tratamento no SisEscala, com quatro exigências do gestor:

1. diferenciar a origem de cada marcação (relógio / terminal web / ajuste do coordenador / ajuste do servidor);
2. prioridade de conciliação: relógio primeiro, depois terminal, depois ajuste manual;
3. **marcação real nunca alterada** — e o original preservado mesmo quando um administrador ajusta por cima;
4. logs de auditoria.

Enquadramento que organiza tudo: o relógio é um **REP-C certificado** (memória MRP permanente,
AFD assinado em Ed25519, NSR que nunca reseta) e o SisEscala passa a ser o **PTRP** da Portaria
671/2021 — pode complementar e tratar, jamais alterar o dado original, e deve manter histórico.

---

## Fase 0 — dívida técnica anterior ao relógio

### Um bug de folha de ponto que já estava em produção

A folha decidia se um horário era "manual" lendo `logs_sobreaviso.motivo_acionamento` com
`.includes('entrada')` / `.includes('saida')`. Isso estava quebrado por três motivos independentes:

1. desde `20260807020000` a validação manual só grava em `logs_sobreaviso` para Sobreaviso — então
   **validação manual de Regular, Plantão e Extra entrava na folha como origem `'real'`**;
2. `'saida'` sem acento nunca casou com `'Saída'`;
3. os passos de intervalo não tinham detecção nenhuma.

**Impacto medido em produção:** em 08/2026, **461 marcações** apareciam na folha como batida real
de terminal quando foram validação manual do coordenador. Os passos de intervalo eram o caso mais
grave — 68% das saídas e 63% dos retornos.

A fonte correta sempre esteve na própria linha (`presenca_*_manual`); a folha não a lia. Corrigido
com o helper único [`src/utils/folha/origemMarcacao.ts`](../../src/utils/folha/origemMarcacao.ts),
aplicado nas **quatro** cópias da geração de folha (`folha-ponto/actions.ts` ×2,
`consultar-escala/actions.ts` ×2). Ganho de precisão: a flag passa a ser lida **da mesma linha que
forneceu o horário vencedor** do MIN/MAX, e não de "algum turno do dia".

### Outros dois itens

- **`20260807120000`** — CNPJ, razão social e responsável legal em `unidades`, com
  `UnidadeDadosFiscais.tsx` compartilhado pelos dois formulários. CNPJ e CPF gravados **só com
  dígitos**, com CHECK de formato.
- **`20260807130000`** — fechado o `WITH CHECK (true)` de `logs_tentativas_presenca`. Qualquer
  autenticado podia inserir linha forjada, e desde `20260807090000` essa tabela vira horário de
  folha via `fn_batidas_reais_recusadas`. Bastava a mensagem conter "janela".

---

## Fase 1 — o modelo de dados

Quatro migrations, sem mudança de comportamento.

| migration | conteúdo |
|---|---|
| `20260808000000` | enum `marcacao_origem`, `fn_precedencia_origem` e 6 tabelas |
| `20260808010000` | imutabilidade: triggers, revokes, RLS, verificação de integridade |
| `20260808020000` | colunas de origem em `escala_diaria`, `fn_competencia_encerrada` e o guard |
| `20260808030000` | backfill do histórico |

**Backfill: 7.142 marcações** a partir de 6.512 linhas de `escala_diaria` — 6.681 de origem
`terminal`, 461 `ajuste_coordenador`, 1.912 sintéticas (27%), **zero** em linha de Sobreaviso.
A contagem bateu exatamente com a previsão.

O `id` é determinístico (`md5('sisescala:backfill:' || escala_diaria.id || ':' || passo)`), o que
torna a migration idempotente numa tabela que não aceita `DELETE`.

**Mudança de comportamento única:** o guard de competência encerrada. Junho/2026 está fechado, então
presença naquele mês passou a ser recusada. Antes disso, `isCompetencyClosed` protegia apenas
`folha_ponto` — dava para gravar batida em mês fechado e a folha deixar de bater com `escala_diaria`.

---

## Fase 2 — reconciliação em shadow

`fn_blocos_previstos_dia` foi **extraída por cópia mecânica** de `fn_confirmar_presenca`, conforme a
regra 2 do `CLAUDE.md`. O script de geração aborta se qualquer contagem divergir, e abortou duas vezes:

- a âncora `AND ed.dia = v_dia_hoje` aparecia **2×** — a primeira é a checagem de *acesso* do
  coordenador, que inclui Sobreaviso de propósito. Extrair dali traria o trecho errado.
- os "8 guards de Sobreaviso" do `CLAUDE.md` são 8 **pontos de fusão**, não 8 ocorrências: são 14 no
  arquivo, 7 por região.

O `diff` final mostrou **um único hunk** — a substituição pretendida. `fn_confirmar_presenca` não foi
tocada.

Sobre `fn_alocar_marcacoes_dia`: programação dinâmica monotônica de custo mínimo, **um DP por origem**
com fusão por precedência depois. Um DP único misturando origens transformaria um ajuste de *entrada*
em marcação de *saída do intervalo* quando o relógio já tivesse registrado a entrada.

### O portão de qualidade

Registrado em [`2026-08-08-portao-fase2-reconciliacao-de-marcacoes.md`](2026-08-08-portao-fase2-reconciliacao-de-marcacoes.md).
Aprovado, com todas as divergências explicadas. Dois bugs foram encontrados nele — ambos invisíveis
até a execução, porque `LANGUAGE plpgsql` não valida o corpo no `CREATE FUNCTION`:

1. **`text[] || 'entrada'`** → `22P02 malformed array literal`. Literal sem tipo faz o Postgres
   escolher a sobrecarga `anyarray || anyarray`.
2. **Janela de busca ancorada no calendário** (~48h) em vez de nos slots. Batidas dos dias vizinhos
   entravam na disputa e o DP as encaixava, com erros de 1440 e 2880 minutos — 1 e 2 dias exatos.

| | antes | depois |
|---|---|---|
| divergências em 01–07/08 | 663 | **286** |
| deslocamento de dia | ~166 | **1** |
| projeção inventando horário | 209 | **16** |

---

## Fase 3 — sincronização em paralelo

**Divergência deliberada do plano.** Em vez do `PERFORM` dentro de `fn_confirmar_presenca`, um
trigger `AFTER UPDATE` em `escala_diaria`. Motivos: não recria a função de 1.055 linhas que já sofreu
seis regressões; captura também `fn_salvar_saida_bloco`, que escreve presença por fora; e usa os
mesmos critérios do backfill, mantendo histórico e corrente com a mesma semântica.

Três cuidados: guard anti-eco (a reconciliação da Fase 5 escreveria em loop), tratamento de reversão
via `desconsiderar` (a marcação não é apagada — a tabela é imutável) e `EXCEPTION WHEN OTHERS` para
**nunca travar uma batida de ponto** por falha de sincronização.

---

## Fase 4 — ingestão do REP (parcial)

`20260808080000` traz cadastro de dispositivo, token do coletor, parse de AFD, ingestão idempotente
e sugestão de vínculos.

O layout foi **validado contra o arquivo real** antes de rodar — 15.646 registros tipo 3 e 1.514
tipo 5.

### Teste de ponta a ponta com hardware real

Relógio em `10.110.2.89`, com duas biometrias já cadastradas. Duas batidas reais de 07/08 às 22:20
e 22:23 (Fernando e Hugo) atravessaram todo o caminho novo:

| verificação | resultado |
|---|---|
| linhas ingeridas | 27 → 26 registros (a 27ª é a linha de nome do arquivo, ignorada) |
| marcações criadas | 2 |
| órfãs | **0** — ambas resolveram para o servidor certo |
| reenvio do mesmo lote | `reenvio: true`, sem reprocessar |
| cadeia de hash | **`integro: true`** |

### Terceiro bug, encontrado pelo teste

`fn_vinculos_sugeridos_afd` usava `ltrim(identificador, '0')`, que remove **todos** os zeros à
esquerda. O identificador do AFD é o CPF preenchido a 12 posições com **um** zero:

```
053638930459 → ltrim → 53638930459  (11)  CPF 53638930459  ✅
008943857128 → ltrim →  8943857128  (10)  CPF 08943857128  ❌
```

**47 dos 127 servidores com CPF preenchido começam com zero — 37% da base.** O sintoma em campo
seria órfã fantasma no módulo de pendências, levando alguém a vincular a pessoa errada na mão.
Corrigido em `20260808090000` com `right(ident, 11)`.

O defeito **não** existia em `fn_ingerir_afd`, que resolve por igualdade exata — por isso as duas
batidas foram atribuídas corretamente no mesmo teste.

---

## Achado estrutural: a matrícula não existe no AFD

Confirmado no arquivo real: o registro tipo 3 (marcação) carrega apenas
`NSR + data/hora + identificador(12) + CRC`. A matrícula só aparece no tipo 5 (cadastro) e no
`load_users.fcgi`.

Consequência dura: **o cadastro do equipamento é a única tabela de junção**, e precisa ser
snapshotado em `rep_vinculos_servidor` **antes** de qualquer `remove_users.fcgi` — apagado o usuário
do relógio, os NSRs antigos ficam órfãos para sempre. O vínculo tem vigência temporal porque
matrícula temporária vira definitiva e servidor é transferido; sem isso, uma correção de hoje faria
batidas antigas resolverem para outra pessoa.

---

## Pendências

| # | assunto | quando |
|---|---|---|
| 1 | Testar o trigger da Fase 3 com gente batendo ponto (bater, validar, reverter) | próximo dia útil |
| 2 | Decidir o destino das 103 marcações de intervalo em unidades com `permite_marca_intervalo = false` — a reconciliação as apagaria | antes da Fase 5 |
| 3 | Rotas `/api/rep/v1`, coletor em Go, módulo `/marcacoes` | Fase 4 |
| 4 | Convergir as três regras de intervalo | Fase 8 |
| 5 | `pis_pasep` vazio em 100% dos registros — auditor fiscal casa por PIS/NIS | Fase 9 |

## Verificação

Cada migration traz `CONFERENCIA APOS APLICAR` no rodapé. Scripts de verificação usados nesta
sessão ficaram no scratchpad: `portoes_fase2.js`, `intervalo_incoerente.js`, `explicar_diffs.js`,
`ingerir_teste.js`, `gen_blocos.js`.

`npx tsc --noEmit` e `npm run build` limpos.
