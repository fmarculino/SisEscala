# O relógio foi trocado e o SisEscala não percebeu

**06/09/2026 — CCE (Centro de Cirurgias Eletivas, HMM).**

Diário da sessão. O plano que saiu daqui está em
[`docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md`](../planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md).

---

## O relato

> "Tive que trocar o relógio aqui pois apresentou defeito, e esse relógio já tinha sido carregado
> com os usuários desta unidade. Ao trocar, mesmo configurando com o mesmo IP e a mesma senha web,
> não está carregando novamente os usuários. Quando vou ver no SisEscala, lá diz que os servidores
> já estão no relógio e a maioria sem a digital — o que não é verdade, isso estava no relógio
> antigo; no novo ainda não tem nenhum cadastro."

Relato preciso, e o sistema concordava com ele por dentro: nada estava corrompido, tudo estava
**afirmando com confiança uma coisa que já não era verdade**.

## O que se mediu

| | |
|---|---|
| snapshot (`rep_usuarios_dispositivo`) do CCE-01 | **0 linhas** |
| vínculos vigentes | **35**, criados em 01–02/09 no equipamento ANTIGO |
| fila de cadastro | 35 `enviado`, **0 pendente** |
| servidores Ativos lotados nos 10 setores | **35**, todos com CPF |
| dispositivos do parque no mesmo estado | **1** (só o CCE) |

## A causa

```sql
IF v_total > 0 THEN   -- fn_registrar_snapshot_usuarios_dispositivo
```

A guarda de **lista vazia nunca reconcilia**, escrita em 22/08/2026 e comentada no próprio corpo da
função. O relógio novo respondeu "zero cadastros"; o `DELETE` do snapshot roda **antes** da guarda,
então o snapshot esvaziou — e nenhum vínculo foi encerrado. A partir daí:

- `fn_enfileirar_cadastros_rep` pula quem tem vínculo vigente → `ja_vinculados: 35`,
  `enfileirados: 0`. **Clicar em "Sincronizar cadastros" de novo não muda nada, nunca.**
- `fn_cobertura_ponto_dispositivo` classifica **pelo vínculo** quando não acha a pessoa no snapshot
  → 34 `sem_biometria` + 1 `ok`. Palavra por palavra o que a tela mostrava ao usuário.

⚠️ **A guarda não é o defeito, e tirá-la seria pior.** A rota
`/api/rep/v1/usuarios-dispositivo` cai para `[]` quando o corpo vem malformado; sem a guarda, um
POST torto encerraria os vínculos de uma unidade inteira.

✅ **O defeito é que a informação que separa os dois casos existe e é jogada fora no transporte.**
Em `ciclo.go`, `ListarUsuarios()` que falha faz `return` e **nunca chega a postar**. Quem posta `[]`
leu o equipamento e achou zero. O payload é que não sabe dizer isso — falta um `leitura_ok`.

## A descoberta que o relato não continha

Perguntado se o equipamento novo herdou a memória de ponto (MRP) do antigo, o usuário confirmou:
**é equipamento inteiramente novo**. Logo o AFD dele começa no NSR 1.

`fn_cursor_afd_dispositivo` devolve **111509** — fim do trecho contíguo do relógio ANTIGO, mais 1.
O coletor pede `get_afd.fcgi?initial_nsr=111509` a um equipamento cujo maior NSR é um número
pequeno e recebe nada. Medido: nenhuma sincronização do CCE desde 06/09 14:54 UTC, e a última
trouxe NSR 111508 — ainda do equipamento antigo.

🚨 **E se chegasse seria pior.** As duas tabelas casam por `(dispositivo_id, nsr)`:

```sql
ON CONFLICT (dispositivo_id, nsr) DO NOTHING                                      -- fn_ingerir_afd
CREATE UNIQUE INDEX uq_marcacao_rep_nsr ON marcacoes_ponto (dispositivo_id, nsr)  -- WHERE origem = 'rep'
   ```

Os NSR 1..N do relógio novo colidiriam com os 1..111508 do antigo e seriam **descartados como
duplicados, sem erro em lugar nenhum**.

✅ **Nada se perdeu.** O AFD fica no equipamento até alguém buscá-lo — o mesmo princípio que já vale
para relógio sem rede. Enquanto a correção não sai, o sinal de vigilância é
`rep_sincronizacoes` do CCE com `linhas_duplicadas > 0`; hoje está em zero, que é o comportamento
inofensivo dos dois possíveis.

**Este achado não estava no relato e não apareceria numa leitura de código.** Só medindo o cursor
contra o histórico do dispositivo.

## O que foi aplicado em produção

`scratchpad/fix_cce_recarga.mjs`, com pré-condições que abortam se o diagnóstico mudar (snapshot
tem que estar em zero — se o relógio já tiver sido lido com cadastros, encerrar vínculo seria
errado):

1. encerrados os **35** vínculos que apontavam para o equipamento substituído;
2. `fn_enfileirar_cadastros_rep` → **35 enfileirados**;
   `fn_enfileirar_cadastros_por_escala` → 0 (não há Servidor Externo no CCE).

Conferido nos dois ciclos seguintes: **35 gravados no relógio, fila zerada, 0 falhas.** As criações
terem sido aceitas confirma por fora que o equipamento estava mesmo em branco — num relógio que já
tivesse aquelas pessoas, `add_users.fcgi` responderia `PIS já cadastrado`.

⚠️ **Encerrar vínculo não mexe em ponto passado**: a autoria é resolvida pelo vínculo vigente **na
data da batida**, e `vigente_ate = now()` só fecha dali para frente. É reversível — o coletor abre
vínculo novo ao confirmar cada cadastro, e foi o que aconteceu.

⚠️ **A biometria não volta com isso: 0 de 35 têm digital no equipamento novo.** O template vive no
relógio, e o relógio é outro. É recadastro presencial, pessoa por pessoa. A cópia automática entre
relógios (v0.10.0) não ajuda: o CCE-01 é o único equipamento da unidade naqueles setores.

## Os dois achados de parque, medidos na mesma passada

**A remoção bloqueia exatamente quem precisa sair.**
`fn_enfileirar_remocao_usuarios_dispositivo` recusa todo candidato com `servidor_status = 'Ativo'`
— e quem mudou de unidade ou de setor **continua Ativo**. Só `Inativo` e `Afastado` passam hoje.

**Candidatos reais de remoção no parque: 15** (`scratchpad/an_candidatos_remocao_rep.mjs`).

🚨 Pelo critério ingênuo de lotação pura seriam **140**. Os outros 125 são **Servidor Externo** —
escalados naquela unidade, lotados em outra — mais o administrador do parque. O critério tem que
ser **lotação ∪ escala**, a mesma união que a aba Cobertura de Ponto adotou em 05/09/2026. Foi a
medição que impediu a correção óbvia de tirar do ponto 125 pessoas que batem ali todo dia.

## Decisões do usuário registradas nesta sessão

| decisão | motivo |
|---|---|
| troca de equipamento vira **coluna `geracao`** no mesmo dispositivo, não dispositivo novo | mantém token, `config.yaml`, vínculos e histórico num lugar só — nenhuma máquina reconfigurada em campo a cada troca |
| `Afastado` **não** é removido automaticamente do relógio, só sinalizado | remover apaga a biometria; afastamento é temporário e a volta exigiria recadastro presencial, que é o gargalo real do parque |
| o cron **enfileira candidato a remoção; a tela confirma** | remover é irreversível quanto à digital, e um mês sem escala lançada faria a detecção errar em bloco |

## O laço que ainda não existe, e por que ele é fácil de criar

Exclusão feita direto na telinha do relógio **já** volta sozinha: o snapshot encerra o vínculo
ausente e, desde 05/09/2026, o cron diário reenfileira. Mas **nada distingue "sumiu do relógio" de
"o SisEscala mandou tirar"**.

Hoje isso não vira laço só por acidente: a higiene não consegue remover quem é `Ativo`, e o
enfileiramento só pega `Ativo`. **No instante em que a remoção passar a alcançar quem é Ativo — que
é justamente a correção pedida — o cron do dia seguinte recoloca a pessoa no relógio.** A defesa
(pular quem tem remoção `removido` e ainda não pertence) tem que entrar na **mesma** migration, não
depois.
