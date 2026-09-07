# Troca de relógio e ciclo de vida do cadastro no REP

**06/09/2026 — motivado pela substituição do equipamento do CCE (HMM).**

O relógio do CCE apresentou defeito e foi trocado por um equipamento novo, mesmo IP e mesma senha
web. O SisEscala não percebeu a troca: continuou afirmando que os 35 servidores estavam no relógio,
e o botão "Sincronizar cadastros" devolvia zero — para sempre. Este documento registra o que foi
medido, o que já foi corrigido em produção e o que falta.

O caso do CCE não é excepcional. **Relógio vai quebrar de novo**, e às vezes sem deixar coletar
nada antes. O sistema precisa tratar substituição de equipamento como evento normal.

---

## 1. O que foi medido em produção (06/09/2026)

### 1.1 O cadastro dos 35 servidores nunca seria reenviado

| | |
|---|---|
| snapshot (`rep_usuarios_dispositivo`) do CCE-01 | **0 linhas** |
| vínculos vigentes (`rep_vinculos_servidor`) | **35**, criados em 01–02/09 no equipamento ANTIGO |
| fila de cadastro | 35 `enviado`, **0 pendente** |
| servidores Ativos lotados nos 10 setores do dispositivo | **35**, todos com CPF |
| escalados que não são lotados (Servidor Externo) | 0 |

**Causa raiz: a guarda 1 de `fn_registrar_snapshot_usuarios_dispositivo`.**

```sql
IF v_total > 0 THEN   -- lista vazia nunca reconcilia
```

O relógio novo respondeu "zero cadastros". A função apagou o snapshot (o `DELETE` roda antes da
guarda) e **não encerrou vínculo nenhum**. A partir daí, os dois lados mentem em silêncio:

- `fn_enfileirar_cadastros_rep` pula quem tem vínculo vigente → `ja_vinculados = 35`,
  `enfileirados = 0`. Clicar de novo não muda nada, nunca.
- `fn_cobertura_ponto_dispositivo`, sem snapshot, classifica **pelo vínculo** → 34 `sem_biometria`
  + 1 `ok`. É exatamente o "eles já estão no relógio, a maioria sem digital" que a tela mostrava.

⚠️ **A guarda existe por um motivo real e não pode simplesmente sair**: a rota
`/api/rep/v1/usuarios-dispositivo` cai para `[]` quando o corpo vem malformado, e encerrar os
vínculos de uma unidade inteira por causa de um POST torto é muito pior que o defeito que ela
causa.

✅ **Mas a informação que separa os dois casos EXISTE no coletor e é jogada fora no transporte.**
Em `ciclo.go`, `ListarUsuarios()` que falha faz `return` e **nunca chega a postar**; quem posta
`[]` leu o equipamento e achou zero. Falta o payload dizer isso. É aí que a correção entra —
não em afrouxar a guarda.

### 1.2 🚨 O cursor de NSR está travado, e a batida do relógio novo não chega

Confirmado com o usuário: **é equipamento inteiramente novo**, não houve transferência do módulo
de memória (MRP). Logo o AFD dele começa no NSR 1.

`fn_cursor_afd_dispositivo` devolve **111509** (fim do trecho contíguo do equipamento ANTIGO + 1).
O coletor pede `get_afd.fcgi?initial_nsr=111509` a um relógio cujo maior NSR é um número pequeno —
e recebe nada. Medido: **nenhuma sincronização do CCE desde 06/09 14:54 UTC**, e a última trouxe
NSR 111508, ou seja, ainda do equipamento antigo.

E se o AFD chegasse, seria pior:

```sql
ON CONFLICT (dispositivo_id, nsr) DO NOTHING   -- fn_ingerir_afd
CREATE UNIQUE INDEX uq_marcacao_rep_nsr ON marcacoes_ponto (dispositivo_id, nsr) WHERE origem = 'rep'
```

Os NSR 1..N do relógio novo colidem com os 1..111508 do antigo e são **descartados como
duplicados, sem erro em lugar nenhum**. As duas tabelas têm o mesmo problema.

✅ **Nada se perdeu ainda.** O AFD fica no equipamento até alguém ir buscá-lo — o mesmo princípio
que já vale para relógio sem rede. O prejuízo é reversível enquanto a correção sair antes de a
memória do REP rotacionar, o que leva anos.

⚠️ **Sinal de vigilância enquanto a correção não sai:** `rep_sincronizacoes` do CCE com
`linhas_duplicadas > 0`. Hoje está em zero — o equipamento está devolvendo vazio, que é o
comportamento inofensivo dos dois possíveis.

### 1.3 A remoção bloqueia exatamente quem precisa sair

`fn_enfileirar_remocao_usuarios_dispositivo` recusa todo candidato com
`servidor_status = 'Ativo'`:

```sql
WHERE NOT (c.servidor_id IS NOT NULL AND c.servidor_status = 'Ativo')
```

Quem mudou de unidade ou de setor **continua Ativo**. Ou seja: o caso dominante de "precisa sair
do relógio" é justamente o único que a tela nunca deixa remover. Só `Inativo` e `Afastado` passam.
E nada enfileira remoção sozinho — `rep_remocoes_fila` só é populada por clique.

**Candidatos reais de remoção no parque, medidos hoje: 15.**

| dispositivo | quantos | motivo |
|---|---|---|
| REP iDClass - SMS | 9 | 6 `Afastado`, 3 lotados fora |
| REP-iDClass-CEI | 3 | lotados fora |
| REP-iDClass-HMI-01 | 2 | 1 `Inativo`, 1 `Afastado` |
| REP-iDClass-USF-HIROSHI | 1 | lotado fora |

🚨 **Pelo critério ingênuo de lotação pura seriam 140.** Os outros 125 são **Servidor Externo** —
escalados naquela unidade e lotados em outra — mais o administrador do parque. Removê-los tiraria
do ponto gente que bate ali todo dia. O critério tem que ser **lotação ∪ escala**, a mesma união
que a aba Cobertura de Ponto adotou em 05/09/2026, menos `rep_administradores_parque`.

### 1.4 Exclusão feita direto no relógio já é detectada — quase

O caminho existe e funciona: o snapshot encerra o vínculo ausente (`20260822200000`) e, desde
05/09/2026, o cron diário reenfileira (`enfileirarCadastrosDoParque`). Faltam duas coisas:

- **latência de até 24h** — o snapshot já sabe na hora (`vinculos_encerrados > 0`) e não avisa
  ninguém;
- 🚨 **nada distingue "sumiu do relógio" de "o SisEscala mandou tirar".** Hoje isso não vira laço
  só por acidente: a higiene não consegue remover quem é `Ativo` (1.3) e o enfileiramento só pega
  `Ativo`. **No instante em que a Fase 3 permitir remover quem é Ativo, o cron do dia seguinte
  recoloca a pessoa no relógio** — e a operação vira um cabo de guerra silencioso. A defesa tem
  que entrar **junto** com a Fase 3, nunca depois.

---

## 2. O que já foi feito (aplicado em produção em 06/09/2026)

Destravamento manual do CCE, com as mesmas operações que a Fase 1 passará a fazer sozinha
(`scratchpad/fix_cce_recarga.mjs`, com pré-condições que abortam se o diagnóstico mudar):

1. encerrados os **35** vínculos que apontavam para o equipamento substituído;
2. `fn_enfileirar_cadastros_rep` → **35 enfileirados**; `fn_enfileirar_cadastros_por_escala` → 0
   (não há externo no CCE).

Resultado conferido no ciclo seguinte: **20 gravados no relógio, 15 na fila, 0 falhas** — o que
confirma por fora que o equipamento estava mesmo em branco (`add_users.fcgi` aceitou as 20
criações; num relógio que já tivesse aquelas pessoas ele responderia `PIS já cadastrado`).

⚠️ **Encerrar vínculo não mexe em ponto passado**: a autoria é resolvida pelo vínculo vigente **na
data da batida**, e `vigente_ate = now()` só fecha dali para frente. E é reversível — o coletor
abre vínculo novo ao confirmar cada cadastro.

⚠️ **A biometria dos 35 não volta com isso.** Ela vive no equipamento, e o equipamento é outro. Ou
alguém recadastra a digital presencialmente, ou — se a mesma pessoa tiver digital em outro relógio
da unidade — a cópia automática entre relógios (v0.10.0) resolve. **No CCE não resolve**: é o
único relógio da unidade naqueles setores.

---

## 3. Plano

### Prioridade 0 — a geração do equipamento — ✅ **IMPLEMENTADA em 06/09/2026 (v2.46.0)**

> Migrations `20260906120000` (geração) e `20260906130000` (leitura afirmada), coletor **v0.16.0**,
> botão "Trocamos o aparelho" no modal do Dispositivo REP, e os portões
> `scratchpad/sim_geracao_dispositivo.js` (48 asserções) + `val_sim_geracao_dispositivo.js`
> (8 regressões injetadas, todas reprovadas). Diário em
> [`docs/evolucao/2026-09-06-geracao-do-equipamento-rep.md`](../evolucao/2026-09-06-geracao-do-equipamento-rep.md).
>
> ⚠️ **As duas migrations ainda NÃO foram aplicadas** — a de geração reconstrói dois índices
> únicos sobre ~2,5M e ~2,4M linhas. Meça em homologação, e só então rode
> `fn_registrar_substituicao_dispositivo` para o CCE-01.
>
> Divergência do desenho abaixo, deliberada: **`fn_registrar_marcacao` NÃO ganhou parâmetro** de
> geração — ela a deriva de `dispositivos_rep`. Assinatura nova é objeto novo (armadilha 41) e
> exigiria `DROP` da de 16 argumentos, que 14 migrations chamam por posição; derivar também torna
> impossível um chamador futuro esquecer de passar.

### O desenho original (mantido para referência)

Decisão do usuário (06/09/2026): **coluna `geracao` no mesmo dispositivo**, não um dispositivo
novo. Mantém token, `config.yaml`, vínculos e histórico num lugar só — nenhuma máquina precisa ser
reconfigurada em campo a cada troca, que é o custo que mais dói num parque de 29 relógios.

| peça | o que faz |
|---|---|
| `rep_afd_registros.geracao smallint NOT NULL DEFAULT 1` | qual equipamento disse aquele NSR |
| `marcacoes_ponto.geracao smallint NOT NULL DEFAULT 1` | idem, para o índice parcial de idempotência |
| `dispositivos_rep.geracao_atual smallint NOT NULL DEFAULT 1` | qual equipamento está lá agora |
| unicidade vira `(dispositivo_id, geracao, nsr)` nas duas tabelas | é o que impede o descarte silencioso |
| `fn_cursor_afd_dispositivo` conta **dentro da geração vigente** | relógio novo → cursor volta a 1 sozinho |
| `fn_ingerir_afd` grava `geracao = d.geracao_atual`; cadeia de hash por geração | a cadeia não pode atravessar equipamentos |
| `fn_registrar_substituicao_dispositivo(disp, motivo)` | incrementa a geração, grava histórico append-only, devolve o cursor novo |

⚠️ **`nsr` continua sendo exatamente o que o equipamento disse.** A alternativa considerada — um
`nsr_offset` por dispositivo, que evitaria mexer em 2,49M + 2,39M linhas — foi **descartada**:
falsificaria um campo do artefato legal. `linha_bruta` ficaria intacta, mas a coluna `nsr` passaria
a mentir para qualquer auditoria que a leia.

⚠️ **`ADD COLUMN ... DEFAULT 1` é barato** (PG11+ guarda o default no catálogo, sem reescrever a
tabela). O custo real é reconstruir os dois índices únicos — 2,49M e 2,39M linhas. Medir em
homologação antes.

⚠️ **`marcacoes_ponto` é INSERT-only.** `ADD COLUMN` é DDL e não dispara o trigger de
imutabilidade; e como `fn_bloquear_alteracao_marcacao` compara `to_jsonb(NEW) - '<campo>'`, a
coluna nova já entra coberta pelos três ramos existentes sem nenhuma edição (armadilha 1 —
**os três ramos precisam continuar lá**: reparse de AFD, fusão de setor, mesclagem de cadastro).

**Ao aplicar, rodar `fn_registrar_substituicao_dispositivo` para o CCE-01** — o cursor volta a 1
e todo o AFD do relógio novo entra de uma vez, sem colidir com os 111.508 do antigo.

### Prioridade 1 — o relógio zerado deixa de ser invisível

**1a. O coletor diz que a leitura foi boa.** — ✅ **IMPLEMENTADA em 06/09/2026 (v2.46.0 / coletor v0.16.0).** Ganhou também `dispositivos_rep.usuarios_lidos_em` / `usuarios_lidos_total`: sem esse rastro, leitura boa que devolve zero não deixa marca nenhuma, e a Prioridade 1c fica sem o dado de que precisa.

- `sisescala.ReportarUsuariosDispositivo` passa a enviar `leitura_ok: true` ao lado de `usuarios`.
- A rota só repassa `true` quando o campo vem explicitamente `true`. Coletor antigo não manda →
  `false` → **comportamento de hoje preservado**, nada muda no parque até o coletor subir.
- `fn_registrar_snapshot_usuarios_dispositivo` ganha `p_leitura_ok boolean DEFAULT false` e a
  guarda vira `IF v_total > 0 OR p_leitura_ok THEN`.

⚠️ **Armadilha 41**: assinatura nova é objeto NOVO, nasce com `EXECUTE` para PUBLIC — reescrever
`REVOKE`/`GRANT` na mesma migration e dar `DROP` na de 2 argumentos (senão PostgREST devolve
`PGRST203`). O `DEFAULT` é o que segura a janela migration→deploy: a rota antiga manda 2
argumentos e resolve para a função nova.

⚠️ **A segunda guarda (vínculo com menos de 15 min é poupado) não sai.** Ela protege a corrida
entre ler o relógio paginado e publicar o snapshot, e continua valendo com leitura vazia.

**1b. Sinal duro de substituição, sem depender de ninguém avisar.**
`get_system_information.fcgi` já devolve `last_nsr`, `user_count`, `template_count` e `uptime`, e
hoje **só a CLI `diagnostico` lê isso** — o heartbeat não. Passa a ler (mesma sessão HTTP já
aberta, sem handshake TLS a mais, que é o recurso caro do equipamento) e gravar em
`dispositivos_rep`. Duas detecções:

| sinal | significado |
|---|---|
| `last_nsr` do device **menor** que o nosso máximo da geração vigente | equipamento substituído ou memória zerada — impossível num REP-C, onde o NSR só cresce |
| `user_count = 0` com vínculos vigentes | cadastro apagado em bloco |

⚠️ **Detectar não é agir.** O SisEscala **não** incrementa geração sozinho: mostra o alerta e
oferece o botão. Trocar geração por engano cria um AFD paralelo que ninguém pediu.

**1c. A tela para de afirmar o que não sabe.** `fn_cobertura_ponto_dispositivo` hoje só tem
`sem_snapshot` para "nunca ninguém leu" (`v_snapshot_em IS NULL`). Precisa distinguir disso o
**"leu e o relógio está vazio"**, que é o caso do CCE — hoje ele cai em `sem_biometria`/`ok` pelo
vínculo, que é a afirmação errada.

### Prioridade 2 — exclusão feita no relógio volta sozinha, e mais rápido

- `fn_registrar_snapshot_usuarios_dispositivo` já devolve `vinculos_encerrados`. Quando > 0,
  disparar o reenfileiramento na hora em vez de esperar o cron diário.
- 🚨 **Junto, nunca depois: `fn_enfileirar_cadastros_rep` e `fn_enfileirar_cadastros_por_escala`
  passam a pular quem tem remoção `removido` naquele dispositivo** e ainda não pertence a ele.
  Sem isso, a Fase 3 vira laço (§1.4).

### Prioridade 3 — sair do relógio quando a pessoa deixa de pertencer

- **`fn_pertence_ao_dispositivo(servidor, dispositivo, mes, ano)`** — fonte única, critério
  **lotação ∪ escala**, exatamente o da Cobertura de Ponto. Não replicar em tela nenhuma.
- **`fn_candidatos_remocao_dispositivo(dispositivo)`** — está no snapshot e não pertence. Exclui
  `rep_administradores_parque` (armadilha 13) e `rep_excecoes_ponto`.
- `fn_enfileirar_remocao_usuarios_dispositivo` troca o bloqueio por `status = 'Ativo'` pelo
  bloqueio por **"pertence a este dispositivo"** — a pergunta certa. Hoje ela recusa exatamente o
  caso que precisa passar.
- Cron diário **enfileira candidato e mostra na tela; não remove**. Decisão do usuário
  (06/09/2026): remover é irreversível quanto à digital, e um mês sem escala lançada numa unidade
  faria a detecção errar em bloco.

⚠️ **`Afastado` NÃO é removido automaticamente** (decisão do usuário, 06/09/2026): só sinalizado.
Afastamento é temporário por definição, e remover apaga a biometria — a volta exigiria recadastro
presencial, que é o gargalo real do parque hoje. Remoção automática fica para `Inativo`/exonerado e
para mudança de lotação.

⚠️ **Antes de remover, conferir se a digital sobrevive em outro lugar.** Se a pessoa continua no
parque e o relógio de destino não tem o template dela, remover aqui destrói o único que existe.
`fn_biometria_faltante_dispositivo` já sabe responder isso; a remoção precisa consultá-la.

### Prioridade 4 — portões

Não há framework de teste; o padrão do projeto é simulador que aborta.

| portão | cobre |
|---|---|
| `scratchpad/sim_geracao_dispositivo.js` | cursor por geração, colisão de NSR entre gerações, cadeia de hash que não atravessa equipamento |
| `scratchpad/sim_pertence_dispositivo.js` | lotação ∪ escala, Servidor Externo preservado, admin do parque fora, `Afastado` sinalizado e não removido |
| `scratchpad/sim_snapshot_vazio.js` | leitura vazia confiável reconcilia; payload torto (sem `leitura_ok`) **não** reconcilia; vínculo de 15 min poupado |

Cada um **validado injetando regressão de propósito**, como os anteriores — portão que nunca falha
não vale nada (armadilha 36).

---

## 4. O que NÃO fazer

- **Não remover a guarda de lista vazia** trocando-a por "reconcilia sempre". O POST torto volta a
  encerrar unidade inteira, e esse erro é muito mais caro que o do CCE.
- **Não usar `nsr_offset`** para evitar a migration: falsifica um campo do artefato legal.
- **Não remover do relógio por lotação pura.** Medido: tiraria 125 pessoas que batem ponto
  legitimamente ali como Servidor Externo.
- **Não deixar o SisEscala incrementar geração sozinho** a partir de um `last_nsr` menor. Um
  equipamento que responde torto uma vez criaria um AFD paralelo permanente.
- **Não reingerir automaticamente** o AFD de um relógio cuja geração mudou sem alguém confirmar
  que o equipamento é outro — é a mesma prudência de `ponto_valido_desde` (armadilha 20).
