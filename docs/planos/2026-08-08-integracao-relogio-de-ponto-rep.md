# Integração de Relógio de Ponto (REP-C) e Módulo de Marcações — SisEscala

## Contexto

O SisEscala hoje registra ponto por um **terminal web** (`src/app/presenca/page.tsx` → RPC `fn_confirmar_presenca`) e por **validação manual** do coordenador na grade. A SMS possui relógios de ponto Control iD REP iDClass Bio Prox parados, e um deles já foi validado fisicamente: limpeza dos 155 usuários antigos, carga dos 6 servidores do setor de TI, gravação do Empregador (CNPJ `18478187000107`, razão social = unidade + setor) e coleta incremental de AFD via `get_afd.fcgi?mode=671` com `initial_nsr`.

O objetivo é usar o relógio como **ponto de coleta** e fazer todo o tratamento no SisEscala, com origem da marcação rastreável, prioridade de conciliação definida, auditoria completa e — o requisito mais duro — **marcação real nunca alterada, e o original preservado mesmo quando um administrador ajusta por cima**.

Enquadramento que organiza tudo: o relógio é um **REP-C certificado** (memória MRP permanente, AFD assinado em Ed25519, NSR que nunca reseta). O SisEscala passa a ser o **PTRP** — Programa de Tratamento de Registro de Ponto da Portaria 671/2021. A regra central do PTRP é exatamente o requisito do usuário: *pode complementar e tratar, jamais alterar o dado original, e deve manter histórico*.

### O que a exploração revelou (e muda o escopo)

| # | achado | consequência |
|---|---|---|
| 1 | **O modelo atual é destrutivo.** Cada passo tem UMA coluna em `escala_diaria`. Não há histórico. `fn_salvar_saida_bloco` chega a fabricar até 5 timestamps sintéticos numa única batida, indistinguíveis de batida real. | Incompatível com o requisito de imutabilidade. Exige tabela append-only nova. |
| 2 | **A folha de ponto já está quebrada em produção.** Ela detecta "manual" lendo `logs_sobreaviso.motivo_acionamento` com `.includes('entrada')`/`.includes('saida')`. Desde a migration `20260807020000` a função manual só grava em `logs_sobreaviso` para Sobreaviso → **validação manual de Regular/Plantão/Extra entra na folha como origem `'real'`**. E `'saida'` sem acento nunca casa com `'Saída'`. A folha **não lê** as flags `presenca_*_manual`, que são a fonte correta e já estão populadas. | Correção independente do REP, entra primeiro. Lógica duplicada em **4 lugares**: `folha-ponto/actions.ts:515` e `:1193`, `consultar-escala/actions.ts:1093` e `:1624`. |
| 3 | **O AFD tipo 3 (marcação) carrega só o CPF, nunca a matrícula.** Confirmado no arquivo real: linha de 50 chars = NSR(9) + tipo(1) + data/hora ISO(24) + identificador(12) + CRC(4). O identificador é o CPF com zero à esquerda. A matrícula (`registration`) só existe no registro tipo 5 (cadastro) e no `load_users.fcgi`. | Mas `servidores.cpf` é NULL justamente para quem usa relógio, e `pis_pasep` está vazio em 184/184. **O cadastro do device é a única tabela de junção** — e precisa ser snapshotado ANTES de qualquer `remove_users.fcgi`, senão NSRs antigos ficam órfãos para sempre. |
| 4 | **Três regras de intervalo divergentes convivem**: terminal (`intervalo_inicio_personalizado` → `jornadas.intervalo_inicio_padrao` → início+4h), validação manual (início+4h fixo), folha (ponto médio da jornada). | Convergir é pré-requisito para o REP não produzir um quarto resultado. Fica para a fase final, depois de provado. |
| 5 | `logs_tentativas_presenca` tem policy de INSERT `WITH CHECK (true)` — qualquer autenticado insere linha arbitrária, e essas linhas alimentam `fn_batidas_reais_recusadas`, que grava horário na folha. | Vetor a fechar antes de ampliar a superfície de ingestão. |
| 6 | Nenhuma trava de competência encerrada protege `escala_diaria` — só `folha_ponto`. | Batida retroativa poderia reescrever mês fechado. |

### Decisões tomadas com o usuário

1. **Horário fictício desligado nas unidades com REP.** Dia sem batida fica vazio e vira pendência que exige tratamento do coordenador. Gerar horário fictício contra um AFD que prova que ninguém bateu é fabricar registro de ponto.
2. **Topologia mista.** Coletor central para as unidades alcançáveis por rede/VPN, coletor local onde não houver alcance, pendrive onde não houver internet. O mesmo binário atende os três casos.
3. **Coletor em Go**, `.exe` único (~8 MB), sem runtime, instalável como serviço Windows com um comando.
4. **Papel de PTRP assumido, com exportação AFD/AEJ oficial como fase final.** A disciplina da 671 (imutabilidade, original preservado, histórico de tratamento) entra desde já.

---

## Arquitetura: três camadas separadas

Hoje evidência, fato e juízo estão fundidos numa coluna só. O desenho separa:

| camada | tabela | mutabilidade |
|---|---|---|
| **evidência bruta** (artefato legal) | `rep_afd_registros` | `linha_bruta` imutável |
| **evento de marcação** (quem, quando, por qual origem) | `marcacoes_ponto` | **INSERT-only** |
| **tratamento PTRP** (juízo do coordenador) | `marcacoes_tratamentos` | append-only |
| **projeção** (cache de leitura) | `escala_diaria.presenca_*` | reconstruível a qualquer momento |

A propriedade que faz isso valer: **`escala_diaria` passa a ser descartável**. Se corromper, `fn_reconciliar_marcacoes_dia` reconstrói. Folha de ponto, `ScaleGrid.tsx` e portal do servidor continuam lendo exatamente as mesmas colunas — nada quebra.

### Origem e precedência

```sql
CREATE TYPE public.marcacao_origem AS ENUM (
    'rep',                -- relogio de ponto fisico (coletor online ou pendrive)
    'terminal',           -- terminal web, fn_confirmar_presenca
    'ajuste_coordenador', -- validacao/ajuste manual por coordenador ou admin
    'ajuste_servidor'     -- ajuste solicitado pelo proprio servidor (futuro)
);

-- Prioridade do requisito. NAO usar o ordinal do enum: um ADD VALUE futuro quebraria a ordem.
CREATE OR REPLACE FUNCTION public.fn_precedencia_origem(p_origem public.marcacao_origem)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE p_origem
        WHEN 'rep' THEN 1  WHEN 'terminal' THEN 2
        WHEN 'ajuste_coordenador' THEN 3  WHEN 'ajuste_servidor' THEN 4 END
$$;
```

Menor peso vence. A precedência é aplicada em **um único lugar** — `fn_reconciliar_marcacoes_dia`. Não replicar no frontend; foi replicação de regra que gerou o problema das três regras de intervalo.

`'ficticio'` não entra no enum — não é origem de marcação, é conceito de folha.

---

## Modelo de dados

Seis tabelas novas. SQL completo de referência (colunas, constraints e índices) fica na migration; o essencial:

**`dispositivos_rep`** — relógios cadastrados. `unidade_id`, `setor_id`, `numero_serie`, `endereco_ip`, `cert_fingerprint` (pinning do TLS auto-assinado), `modo_operacao ∈ (pull, usb, pull_com_fallback_usb)`, `token_hash` (sha256 do token do coletor), `ultimo_nsr` (último NSR **aceito** pelo SisEscala), `ultimo_contato_em`, `deriva_segundos`, `ativo`. UNIQUE `(fabricante, numero_serie)`.

**`rep_afd_registros`** — a linha bruta do AFD, artefato legal, nunca alterada nem apagada. `linha_bruta` + `linha_sha256`; colunas parseadas (`ocorrido_em`, `identificador_afd`, `tipo_registro`) são **derivadas** com `parse_versao`, para permitir reparse sem perder o original. `hash_anterior`/`hash_encadeado` = `sha256(hash_anterior || linha_sha256)` por dispositivo em ordem de NSR. UNIQUE `(dispositivo_id, nsr)`.

**`marcacoes_ponto`** — todas as origens, INSERT-only. Campos: `servidor_id` (nullable — órfã nunca é descartada), `origem`, `ocorrido_em` (o fato), `registrado_em` (quando entrou no SisEscala), proveniência REP (`dispositivo_id`, `nsr`, `afd_registro_id`, `identificador_bruto`, `via_pendrive`), proveniência humana (`coordenador_id`, `registrado_por_id`, `justificativa`), contexto congelado (`unidade_id`, `setor_id`), e marcadores `sintetica` / `retroativa`.

```sql
-- Idempotencia por NSR: o coletor e o pendrive podem reenviar a vontade
CREATE UNIQUE INDEX uq_marcacao_rep_nsr ON public.marcacoes_ponto (dispositivo_id, nsr)
    WHERE origem = 'rep';
CREATE INDEX idx_marcacao_orfas ON public.marcacoes_ponto (identificador_bruto, ocorrido_em)
    WHERE servidor_id IS NULL;

CONSTRAINT chk_marcacao_rep_completa CHECK (
    origem <> 'rep' OR (dispositivo_id IS NOT NULL AND nsr IS NOT NULL)),
CONSTRAINT chk_marcacao_ajuste_justificada CHECK (
    origem NOT IN ('ajuste_coordenador','ajuste_servidor')
    OR (justificativa IS NOT NULL AND btrim(justificativa) <> ''))
```

**`marcacoes_tratamentos`** — o coordenador **nunca edita a marcação**, ele registra um juízo sobre ela. `tipo ∈ (desconsiderar, restaurar, reclassificar_passo, reatribuir_servidor, vincular_escala)`, `justificativa NOT NULL`, `registrado_por_id`, `created_at`. É isto que satisfaz literalmente "mesmo que um administrador altere, a real tem que ficar registrada".

**`rep_sincronizacoes`** — sessão de sincronização. `lote_id` (gerado pelo cliente), `canal ∈ (coletor_http, pendrive, manual_ui)`, faixa de NSR, contadores (`linhas_novas`, `duplicadas`, `orfas`), `arquivo_sha256`, `assinatura_verificada`, `coletor_versao`, `importado_por_id`. UNIQUE `(dispositivo_id, lote_id)` → reenvio do mesmo lote é no-op.

**`rep_vinculos_servidor`** — a ponte device→servidor, **com vigência temporal**. `identificador_afd` (o CPF que vem no AFD), `matricula_device`, `nome_device`, `servidor_id`, `device_user_id`, `tem_biometria`, `vigente_de`, `vigente_ate`. UNIQUE parcial em `(dispositivo_id, identificador_afd) WHERE vigente_ate IS NULL`.

> **Por que vigência.** Matrícula temporária `T26xxxxx` vira definitiva; servidor é transferido; CPF é corrigido. Sem vigência, batidas antigas passam a resolver para a pessoa errada retroativamente — que é falsificar ponto histórico.

### Colunas novas em `escala_diaria` (a ponte com o que já existe)

```sql
ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS presenca_entrada_origem           public.marcacao_origem,
    ADD COLUMN IF NOT EXISTS presenca_intervalo_saida_origem   public.marcacao_origem,
    ADD COLUMN IF NOT EXISTS presenca_intervalo_retorno_origem public.marcacao_origem,
    ADD COLUMN IF NOT EXISTS presenca_saida_origem             public.marcacao_origem,
    -- + os 4 presenca_*_marcacao_id uuid REFERENCES marcacoes_ponto(id)
    ADD COLUMN IF NOT EXISTS reconciliado_em      timestamptz,
    ADD COLUMN IF NOT EXISTS reconciliacao_versao integer;
```

Isso **conserta o achado nº2 de graça**: a folha para de inferir origem por `.includes()` em string e passa a ler `presenca_entrada_origem` direto. As flags `presenca_*_manual` continuam sendo escritas por compatibilidade (`ScaleGrid.tsx` as lê), mas viram derivadas de `origem IN ('ajuste_coordenador','ajuste_servidor')`.

Duas colunas mortas voltam a ter uso: `presenca_confirmada_em` = timestamp da reconciliação; `intervalo_nao_usufruido` = calculado pela reconciliação.

### Unidades (requisito 1)

```sql
ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS cnpj text,
    ADD COLUMN IF NOT EXISTS razao_social text,
    ADD COLUMN IF NOT EXISTS responsavel_nome text,
    ADD COLUMN IF NOT EXISTS responsavel_cpf text,
    ADD COLUMN IF NOT EXISTS responsavel_cargo text,
    ADD COLUMN IF NOT EXISTS fonte_ponto_oficial text NOT NULL DEFAULT 'terminal'
        CHECK (fonte_ponto_oficial IN ('terminal','rep'));

ALTER TABLE public.unidades ADD CONSTRAINT chk_unidade_cnpj
    CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');   -- so digitos, formatar na UI
```

`fonte_ponto_oficial` é a **chave de corte**: permite ligar o REP num setor sem tocar em nenhum outro, e reverter invertendo o valor.

**UI:** novo `src/components/UnidadeDadosFiscais.tsx` no molde exato de `src/components/UnidadeIntervaloSettings.tsx` (componente `'use client'` que recebe `initial*` e emite inputs nomeados), consumido pelos dois formulários — `unidades/nova/page.tsx` e `unidades/[id]/page.tsx`. Leitura/gravação em `unidades/actions.ts` (`createUnidade` ~linha 9, `updateUnidade` ~linha 68).

---

## Imutabilidade — cinco camadas

Espelha o padrão de defesa em camadas que o projeto já usa para Sobreaviso, e pela mesma razão: uma camada sozinha morre num `CREATE OR REPLACE` descuidado.

**1. Trigger** (a que sobrevive a tudo):
```sql
CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_marcacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'Marcacao de ponto e imutavel (Portaria 671/2021). Operacao: %. Registre um tratamento em marcacoes_tratamentos.', TG_OP
      USING ERRCODE = 'restrict_violation';
END; $$;

CREATE TRIGGER trg_marcacoes_ponto_imutavel BEFORE UPDATE OR DELETE
    ON public.marcacoes_ponto FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_alteracao_marcacao();
CREATE TRIGGER trg_marcacoes_ponto_no_truncate BEFORE TRUNCATE
    ON public.marcacoes_ponto FOR EACH STATEMENT EXECUTE FUNCTION public.fn_bloquear_alteracao_marcacao();
```
Par equivalente em `rep_afd_registros`, com uma exceção estreita para reparse: permite UPDATE **somente** quando `linha_bruta`, `linha_sha256`, `nsr` e `hash_encadeado` não mudaram **e** `current_setting('sisescala.reparse_afd', true) = 'on'`.

**2. Grants** — `REVOKE UPDATE, DELETE, TRUNCATE ... FROM PUBLIC, anon, authenticated, service_role`. O `service_role` tem BYPASSRLS mas **não** bypassa grants, então revogar dele importa. `REVOKE INSERT` de `authenticated` também: toda escrita passa por `fn_registrar_marcacao` (SECURITY DEFINER). Isso fecha de saída a classe de buraco do `logs_tentativas_presenca`.

**3. RLS** com SELECT de escopo real (por `profile_unidades`, não `USING (true)`) e **nenhuma** policy de INSERT/UPDATE/DELETE.

**4. Cadeia de hash** — `fn_verificar_integridade_marcacoes(p_dispositivo_id)` recalcula a cadeia e aponta o primeiro NSR divergente; roda no cron diário. **Ser honesto na documentação legal:** nenhuma constraint impede um superusuário do banco. O que se tem é *detecção* — e detecção é o que a Portaria exige.

**5. Guard de competência em `escala_diaria`** — trigger que bloqueia alteração dos 4 campos `presenca_*_em` quando `fn_competencia_encerrada(mes, ano)`. Essa função precisa **existir no banco**: hoje a lógica só vive em `src/utils/autoClose.ts` (`isCompetencyClosed`, lendo `configuracoes_globais.competencias_encerradas`).

---

## Casamento batida → escala → passo

### Decisão central: **não chamar `fn_confirmar_presenca`**

Ela é um **portão**, não um **gravador**: rejeita fora de janela, loga tentativa negada, escreve direto em `escala_diaria` e depende do "agora". Uma batida do REP é retroativa e **nunca pode ser rejeitada** — o registro existe independentemente de encaixar na escala. Essa é a diferença legal entre o terminal e um REP-C.

O que se reaproveita é o **cálculo da escala prevista**, que é o conhecimento de domínio mais caro do repositório.

### `fn_blocos_previstos_dia(p_servidor_id, p_data)`

Extraída do trecho de montagem de blocos de `20260807050000_support_flexible_interval_per_servidor.sql` (linhas ~629–925), que contém fusão de blocos contíguos, isolamento de Sobreaviso, alinhamento de Extra, cruzamento de meia-noite e o guard CLT Art. 71.

**Extração obrigatoriamente por script**, conforme a regra 2 do `CLAUDE.md`: copiar o arquivo vigente, aplicar substituições pontuais, **abortar se a contagem de ocorrências divergir**, conferir com `diff`. Nunca redigitar.

Retorna `(bloco_ordem, escala_diaria_ids[], categorias[], inicio_previsto, fim_previsto, intervalo_inicio_previsto, intervalo_fim_previsto, permite_intervalo)`.

**`fn_confirmar_presenca` não é tocada nesta etapa.** A duplicação é temporária e proposital: o custo de errar `fn_confirmar_presenca` (seis regressões já aconteceram) é maior que o de duplicar por alguns meses. Portão de convergência: `fn_conferir_blocos_previstos(data_inicio, data_fim)` compara a função nova com o que as batidas historicamente aceitas implicam. Só depois de zero divergência em 06–08/2026 se considera refatorar.

### `fn_alocar_marcacoes_dia` — pura, não escreve nada

1. **Janela de busca** — considera blocos de `p_data` **e** de `p_data - 1` (plantão que cruza meia-noite). Elegibilidade do bloco de ontem vai até `fim_previsto + rep_tolerancia_alocacao_minutos` (padrão 4h, em `configuracoes_globais`).
2. **Slots candidatos** por bloco: `entrada`, `intervalo_saida`?, `intervalo_retorno`?, `saida`. Os de intervalo só existem se `permite_intervalo` (via `fn_jornada_tem_intervalo`, fonte única).
3. **Marcações efetivas** — todas do servidor na janela, menos as com `desconsiderar` vigente em `marcacoes_tratamentos` (fold por `created_at`).
4. **Deduplicação** — duas batidas da mesma origem a menos de `rep_janela_duplicidade_segundos` (padrão 60) → a segunda é **marcada** duplicada, nunca apagada. É o clássico "encostou o dedo duas vezes".
5. **Matching monótono de custo mínimo** — DP sobre (batida × slot), custo = `|ocorrido_em − previsto|`, com restrição de ordem. Determinístico e ótimo. Corrige explicitamente o que a armadilha 7 do `CLAUDE.md` chama de "guloso e sem reuso". Com ≤12 slots e ≤8 batidas é instantâneo.
6. **Precedência** — origens diferentes disputando o mesmo slot: `fn_precedencia_origem` decide; empate pelo mais próximo do previsto; depois pelo `registrado_em` mais antigo. **A perdedora fica registrada** com `status = 'substituida_por_precedencia'`.
7. **Nunca fabricar.** Número ímpar de batidas → o slot fica vazio com `status = 'pendente_tratamento'`. É o oposto direto de `fn_salvar_saida_bloco`.
8. **Sobreaviso** — excluído dos blocos (as três camadas de defesa ficam intactas). Batida em dia só de Sobreaviso → `status = 'sem_escala'`, guardada, nunca escrita em `escala_diaria` (a CHECK `chk_sobreaviso_sem_presenca` rejeitaria de qualquer forma). Pode opcionalmente alimentar `logs_sobreaviso.data_hora_chegada` com `tipo_validacao_chegada = 'REP'`.
9. **Órfã** (`servidor_id IS NULL`) → nunca descartada, vai para a aba de pendências.

### `fn_reconciliar_marcacoes_dia` — a única que escreve presença

Chama a alocação e faz **um** `UPDATE` por `escala_diaria` afetada, setando os 4 `presenca_*_em`, os 4 `_origem`, os 4 `_marcacao_id`, os 4 `_manual` (derivados), `presenca_confirmada`, `presenca_confirmada_em`, `intervalo_nao_usufruido`, `reconciliado_em`. Sempre com `SET LOCAL sisescala.reconciliacao = 'on'`.

**Idempotente e total**: rodar duas vezes dá o mesmo resultado; rodar sobre um dia sem marcações **limpa** a presença — por isso o corte por `fonte_ponto_oficial` é obrigatório antes de ligar.

Disparo explícito ao fim de `fn_ingerir_afd`, de `fn_registrar_marcacao`, ao registrar tratamento, e por `/api/cron` para dias com `reconciliacao_versao` desatualizada. **Não usar trigger em `marcacoes_ponto`** — um lote de 500 linhas reconciliaria 500 vezes.

---

## Coletor local (Go)

```
tools/coletor-rep/
  main.go              -- subcomandos
  rep/client.go        -- login, load_users, get_afd, add/update/remove_users (.fcgi)
  rep/afd.go           -- decode latin1, split, hash
  sisescala/client.go  -- POST /api/rep/v1/*
  fila/fila.go         -- fila offline em JSONL append-only
  pacote/pacote.go     -- formato .sisrep (pendrive)
  config.yaml.exemplo · README.md
```

O **mesmo binário** atende os três cenários da topologia mista:
```
coletor-rep install | start | stop        -- servico Windows
coletor-rep sync                          -- ciclo online (central ou local)
coletor-rep exportar --saida E:\          -- REP -> .sisrep  (sem internet)
coletor-rep aplicar  --entrada E:\x.sisrep -- .sisrep -> REP (cadastro)
coletor-rep diagnostico                   -- TLS, login, NSR atual, deriva de relogio
```

Go resolve de graça os três problemas específicos deste hardware: `InsecureSkipVerify` + pinning de fingerprint (o `Invoke-RestMethod` falha contra o TLS não-padrão do device), `charmap.ISO8859_1` para o latin1, e `kardianos/service` para virar serviço Windows sem wrapper externo.

### Ciclo online

1. `login.fcgi` → token de sessão (cache em memória, refresh em 401).
2. `get_afd.fcgi?mode=671` com `{"initial_nsr": ultimo_nsr + 1}` — **sempre incremental**.
3. Decodifica latin1→UTF-8 e envia **também o sha256 dos bytes originais**.
4. `POST /api/rep/v1/marcacoes` em lotes de 500, com `lote_id` uuid local.
5. Só avança `ultimo_nsr` após o ACK, que devolve `nsr_max_aceito`.
6. Falha de rede → grava o lote em `%PROGRAMDATA%\SisEscala\fila\<lote_id>.jsonl` e reenvia com backoff (1 → 30 min). Fila append-only; `lote_id` garante que reenvio é no-op.
7. `POST /api/rep/v1/heartbeat` — versão, NSR do device, relógio do device (de `get_system_information.fcgi`) → o servidor calcula `deriva_segundos`.
8. `GET /api/rep/v1/pendencias` → operações de cadastro → aplica via `add/update/remove_users.fcgi` → confirma.

O coletor **nunca ajusta o relógio do device em silêncio** — num REP-C isso é operação legalmente registrável. Só reporta a deriva.

### Protocolo (`src/app/api/rep/v1/`)

**Não copiar o padrão de `/api/cron`** (segredo compartilhado com fallback hardcoded `'sis-escala-cron-token-2026'`).

- Token **por dispositivo**, exibido uma vez, guardado como sha256 em `dispositivos_rep.token_hash`.
- `Authorization: Bearer <token>` + `X-SisEscala-Dispositivo: <uuid>`.
- Anti-replay: `X-SisEscala-Timestamp` + `X-SisEscala-Assinatura` = `HMAC-SHA256(token, timestamp || sha256(body))`, rejeitando desvio > 5 min.
- Autenticação via `fn_autenticar_dispositivo_rep` (SECURITY DEFINER, comparação em tempo constante, atualiza `ultimo_contato_em`).
- Idempotência por `(dispositivo_id, lote_id)`: reenvio devolve o resultado anterior com HTTP 200 sem reprocessar.
- Ingestão em **transação única** por lote via `fn_ingerir_afd(dispositivo_id, lote_id, linhas jsonb, canal)` com `ON CONFLICT (dispositivo_id, nsr) DO NOTHING`.
- A rota usa `createAdminClient()` **depois** de autenticar o dispositivo — nunca a anon key, nunca RLS como única defesa.

---

## Pendrive (plano B)

**Testar primeiro se o iDClass exporta AFD por USB pelo próprio menu.** Se exportar, a unidade sem internet precisa de **zero software instalado** — só a tela de importação web, e o `coletor-rep exportar` fica só para o caso do cadastro na direção inversa.

### Formato `.sisrep`

JSON UTF-8 inspecionável: `dispositivo_id`, `unidade_id`, `lote_id`, `gerado_em`, `nsr_inicial`/`nsr_final`, `afd_base64`, `afd_sha256`, `assinatura_hmac`.

**Regra de ouro: `afd_base64` carrega os bytes ORIGINAIS latin1, sem transcodificar.** A conversão acontece uma única vez, no servidor, em `src/utils/rep/afd.ts` (`Buffer.from(b64,'base64').toString('latin1')` — Node suporta nativamente). Isso mata o problema de acentuação num ponto só e preserva o artefato legal.

Integridade em camadas: HMAC do dispositivo → assinatura **Ed25519 do próprio REP-C** (verificar com `crypto.verify('ed25519', …)` se a chave pública estiver disponível; se não, gravar `assinatura_verificada = false` e **exibir na UI**, sem bloquear a ingestão) → `afd_sha256` (corrupção de transporte) → UNIQUE `(dispositivo_id, nsr)` (reimportação).

### Tela `src/app/(dashboard)/marcacoes/importar/`

Drop do arquivo (`.sisrep` ou `AFD*.txt` cru) → **preview sem gravar** (NSRs novos vs. existentes, faixa de datas, servidores resolvidos vs. órfãos, estado da assinatura, deriva detectada) → confirmação chama a **mesma** `fn_ingerir_afd` com `canal = 'pendrive'`. Reimportar o mesmo pendrive é inócuo: o preview diz "0 novos". Registra em `logs_sistema` com `acao = 'IMPORTACAO_AFD_PENDRIVE'`.

---

## Módulo de marcações — `src/app/(dashboard)/marcacoes/`

| aba | conteúdo |
|---|---|
| **Marcações** | Linha do tempo por servidor/dia com origem (ícone + cor), NSR quando REP, e todas as marcações do dia — inclusive as substituídas por precedência e as desconsideradas, riscadas. |
| **Pendências** | Órfãs (identificador não resolvido), ímpares (falta um passo), sem escala, duplicadas, competência encerrada. É a fila de trabalho do coordenador. |
| **Dispositivos** | Cadastro, geração de token, `ultimo_contato_em` ("sem contato há X"), NSR do device vs. NSR aceito, deriva de relógio, botão de diagnóstico. |
| **Sincronizações** | Histórico de lotes (canal, faixa de NSR, contadores, assinatura verificada, quem importou). |
| **Importar** | Fluxo de pendrive descrito acima. |

Listagens via **RPC paginada** — nunca PostgREST direto, por causa do corte silencioso em 1000 linhas (`escala_diaria` já tem ~3.500 linhas só em 08/2026).

Reaproveitar `src/components/ui/{Modal,DialogProvider}.tsx`, o padrão `getUserProfile` + `createAdminClient()` + `applyAccessFilters` de `justificativas/actions.ts`, e registrar o menu em `src/components/layout/sidebar.tsx`.

---

## Faseamento

As três primeiras fases **não dependem de nada do REP** e já valem produção sozinhas.

### Fase 0 — dívida atual (produção imediata, risco quase zero)
- **0.1** CNPJ, razão social, responsável (nome/CPF/cargo) em `unidades` + `UnidadeDadosFiscais.tsx` nos dois formulários.
- **0.2** **Folha passa a ler `presenca_*_manual` em vez de `logs_sobreaviso.motivo_acionamento`.** Extrair o helper para `src/utils/folha/origemMarcacao.ts` e aplicar nas **quatro** cópias (`folha-ponto/actions.ts:515` e `:1193`, `consultar-escala/actions.ts:1093` e `:1624`).
- **0.3** Fechar o INSERT `WITH CHECK (true)` de `logs_tentativas_presenca`, forçando tudo por `fn_log_tentativa_negada`.

*Verificação:* rodar `sincronizarFolha` num servidor com validação manual conhecida em 08/2026 e conferir que `origem_entrada` volta a `'manual'` em vez de `'real'`.

### Fase 1 — modelo de dados no escuro (nada muda de comportamento)
Enum, `fn_precedencia_origem`, as 6 tabelas, triggers de imutabilidade, revokes, RLS, colunas novas em `escala_diaria`, `fn_competencia_encerrada`.

**Backfill:** criar `marcacoes_ponto` para cada `presenca_*_em` já existente, com `retroativa = true`, `origem` derivada das flags `_manual`, e `sintetica = true` para timestamps redondos `:00:00` (a heurística da armadilha 5 — os fabricados por `fn_salvar_saida_bloco`).

*Verificação:* `COUNT(marcacoes_ponto WHERE retroativa)` == soma dos 4 campos não nulos em `escala_diaria`; `npx tsc --noEmit` e `npm run build` intocados.

### Fase 2 — reconciliação em shadow (não escreve nada)
`fn_blocos_previstos_dia` (extraída por script), `fn_alocar_marcacoes_dia` (pura), `fn_reconciliar_marcacoes_dia` (escreve, mas ninguém chama) e o portão `fn_conferir_reconciliacao(data_inicio, data_fim)`, que devolve o **diff** entre o que a reconciliação escreveria e o que `escala_diaria` contém hoje.

**Portão de qualidade:** rodar sobre 06–08/2026 em homologação. Cada divergência é triada uma a uma — ou é bug da função nova, ou é defeito conhecido do caminho antigo (ex.: os timestamps fabricados). **Só passa quando cada linha do diff tiver explicação escrita.** Este é o substituto do framework de testes que o projeto não tem.

### Fase 3 — caminho de escrita, só terminal
`fn_registrar_marcacao(...)` e **um único `PERFORM` aditivo** ao final de `fn_confirmar_presenca` e de `fn_confirmar_presenca_manual`. Nenhum ramo existente é tocado — superfície de regressão mínima. `escala_diaria` continua sendo escrita pelo caminho antigo; `marcacoes_ponto` roda em paralelo por uma semana e é comparada diariamente.

### Fase 4 — ingestão REP, sem afetar a folha
`dispositivos_rep` + UI, **`rep_vinculos_servidor` populada a partir de `load_users.fcgi` antes de qualquer remoção**, rotas `/api/rep/v1/*`, coletor v1, módulo `/marcacoes` (leitura + pendências). Levantamento de rede aqui, para decidir onde o coletor central alcança e onde precisa de coletor local.

Batidas do REP entram, são alocadas e aparecem **lado a lado** com o que `escala_diaria` diz — mas **não** escrevem nela. É aqui que a realidade aparece (deriva de relógio, dedo errado, quem esquece de bater) com risco zero para a folha. Deixar rodar um mês inteiro.

### Fase 5 — virar a chave, por unidade/setor
`fonte_ponto_oficial = 'rep'` no setor de TI (os 6 servidores já carregados). A reconciliação passa a escrever `escala_diaria`, o guard passa a exigir `sisescala.reconciliacao = 'on'`, o terminal para de escrever presença diretamente, e **o ramo de horário fictício é desligado para essas unidades** (decisão do usuário) — dia sem batida vira pendência. **Reversível invertendo o enum.** Um setor, um mês.

### Fase 6 — pendrive
Formato `.sisrep`, tela de importação, subcomandos do coletor. Depois de 4/5 porque reusa a mesma `fn_ingerir_afd` e o mesmo parser.

### Fase 7 — cadastro push SisEscala → REP e biometria
Fila de pendências, coletor aplica, tela de "servidores pendentes de biometria" (cadastro presencial — o template vem do sensor e não é enviável por API). Deliberadamente por último: hoje isso é feito manualmente e funciona.

### Fase 8 — convergência da regra de intervalo e `ajuste_servidor`
Terminal, validação manual e folha passam a usar `fn_blocos_previstos_dia` como fonte única. Só depois de meses de `fn_conferir_reconciliacao` limpo. Aqui também entra o ajuste solicitado pelo próprio servidor no portal.

### Fase 9 — PTRP formal
Exportação de **AFD** e **AEJ** nos layouts oficiais da Portaria 671, espelho de ponto assinado, e o cadastro de Empregador com a razão social real da SMS. Em paralelo, o projeto de qualidade de dados: **`servidores.cpf` é NULL para quem usa relógio e `pis_pasep` está vazio em 184/184** — auditor fiscal casa por PIS/NIS. O `load_users.fcgi` devolve CPF, matrícula e nome juntos, então dá para propor o preenchimento a partir do device, sempre com confirmação humana, nunca automática.

---

## Riscos

| # | risco | mitigação |
|---|---|---|
| 1 | **Regressão em `fn_confirmar_presenca`** (seis já aconteceram) | Fases 1–4 não a tocam. Fase 3 adiciona **um** `PERFORM`, gerado por script com `diff` e contagem de ocorrências, conforme a regra 2 do `CLAUDE.md`. Extração real só na Fase 8. |
| 2 | **NSRs órfãos** por remoção de usuário do device | `rep_vinculos_servidor` com vigência, populada **antes** de qualquer `remove_users.fcgi`. Batida órfã nunca descartada. |
| 3 | **Deriva do relógio do REP** | `heartbeat` grava `deriva_segundos`, alerta acima de 60 s. O coletor nunca ajusta em silêncio. Deriva registrada por sincronização, para explicar batidas deslocadas depois. |
| 4 | **Corte de 1000 linhas do PostgREST** | Todo listar do módulo via RPC paginada; ingestão nunca faz SELECT ilimitado. |
| 5 | **Lote grande / aplicação parcial** | Lotes de 500, transação única, `ON CONFLICT DO NOTHING`, NSR só avança após ACK. |
| 6 | **Batida dupla no leitor** | Janela de duplicidade configurável; duplicata marcada, nunca apagada. |
| 7 | **Imutabilidade contornável por superusuário do banco** | Honestidade documental: é *detecção*, não prevenção. Cadeia de hash + verificação diária no cron. |
| 8 | **Requisitos de prioridade e de imutabilidade colidem** | Se o REP chegar *depois* de um ajuste manual, o REP vence e a folha muda debaixo do coordenador — correto pela prioridade, mas exige notificação na UI. O ajuste rebaixado continua visível como `substituida_por_precedencia`. |
| 9 | **Dois bancos divergentes** | Toda migration idempotente; `fn_diagnostico_rep()` reportando quais objetos existem, rodada nos dois. Considerando que o fluxo real aplica migrations direto em produção, cada uma deve ser segura isoladamente e o plano deve dizer quais precisam ir juntas. |
| 10 | **Frota de coletores sem TI local** | Um `.exe`, heartbeat visível no módulo ("sem contato há X"), pendrive sempre como saída, e coletor central onde a rede alcançar. |
| 11 | **AFD retroativo de competência encerrada** | Ingestão **sempre** aceita — o registro existe. A reconciliação recusa escrever e abre `pendencia_competencia_encerrada`, resolvível só por `super_admin` reabrindo. |
| 12 | **Layout do AFD parseado errado** | Por isso `linha_bruta` é armazenada e as colunas parseadas são derivadas com `parse_versao`. Reparse corrige o histórico sem perder o original. |

---

## Verificação

Não há framework de testes; a verificação é executar o caminho real. Por fase:

| fase | como verificar |
|---|---|
| 0 | `npx tsc --noEmit` · `npm run build` · gerar folha de um servidor com validação manual conhecida em 08/2026 e conferir `origem_entrada = 'manual'` |
| 1 | Conferência SQL no rodapé da migration: contagem de `marcacoes_ponto` retroativas vs. campos não nulos em `escala_diaria`; tentar `UPDATE`/`DELETE` numa marcação e confirmar que a exceção sobe |
| 2 | `fn_conferir_reconciliacao('2026-06-01','2026-08-31')` com **cada** linha do diff explicada por escrito |
| 3 | Bater no terminal e conferir que a linha nova em `marcacoes_ponto` casa exatamente com o que foi para `escala_diaria`; grade e folha inalteradas |
| 4 | Ciclo completo no relógio de teste (10.110.2.89): bater → `coletor-rep sync` → linha em `rep_afd_registros` com NSR correto → marcação alocada no módulo. Reenviar o mesmo lote e confirmar "0 novas". Derrubar a rede e confirmar que a fila reenvia. |
| 5 | Um mês no setor de TI, comparando diariamente REP × terminal antes de estender a outro setor |
| 6 | Importar o mesmo pendrive duas vezes e confirmar que o preview mostra "0 novos" na segunda |

Ferramenta útil já validada: `curl.exe -sk` a partir do PowerShell (o `Invoke-RestMethod` falha contra o TLS do device, e o Bash do ambiente não tem rede).
