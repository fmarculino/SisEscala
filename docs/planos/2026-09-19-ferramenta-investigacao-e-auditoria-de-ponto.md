# Investigação e vigilância do ponto — do "alguém reclamou" para o "o sistema avisou"

**Data:** 19/09/2026 · **revisado no mesmo dia**, depois do diagnóstico completo do caso do HMI
**Status:** ✅ **Fases 0 e 1 ENTREGUES** (v2.74.0 e v2.75.0). Resta a §3.3 — ver §4.
**Módulo:** Gestão de Ponto (`/marcacoes`)
**Origem:** o caso do HMI em 18/09/2026 — 509 batidas presas no equipamento por 38h.

> **A revisão em uma frase:** a primeira versão deste plano partia de uma causa-raiz **errada** e
> propunha **três ferramentas que já existem** mais **duas que não podem existir**. O que faltava
> de verdade não era uma tela de investigação — era **alguém avisar**.

---

## 1. O que o diagnóstico completo mudou

A versão original foi escrita com a hipótese de que *"o coletor fatiou em lotes de 500 e o lote
falhou ou ficou retido na fila offline da máquina do RH"*. **Não foi isso**, e a diferença não é
acadêmica: uma fila retida se resolve sozinha (o coletor reenvia a cada ciclo), e a causa real
**nunca** se resolveria.

| o plano dizia | o que foi medido em 19/09/2026 |
|---|---|
| lote retido na fila offline da máquina | **zero** `rep_sincronizacoes` com falha, em todo o histórico |
| coletor sem sincronizar por 38h | coletor **vivo**, com POST chegando e sendo aceito às 14:14 do dia 19 |
| problema de transmissão | problema de **tempo de ingestão no servidor** |

**A causa real:** a rota `/api/rep/v1/marcacoes` refazia, por HTTP, a reconciliação que
`fn_ingerir_afd` já faz na mesma transação. Um lote de 500 linhas gera ~390 pares (servidor, dia);
medido, ~3s por 50 linhas. O conjunto passava dos **60s de timeout do coletor** → o cliente aborta
→ a conexão cai → **o Postgres reverte a transação inteira, inclusive a linha de
`rep_sincronizacoes` que registraria a tentativa** → o cursor continua correto → cinco minutos
depois o coletor remonta **o mesmo lote de 500**. Laço eterno, sem rastro.

🚨 **É isso que reorienta o plano inteiro: a falha era capaz de apagar o próprio registro dela.**
Nenhuma ferramenta de *investigação* — que é, por definição, alguém indo procurar depois — teria
encurtado as 38 horas. O que as encurtaria é **detecção proativa**, e é isso que o plano original
não tinha.

⚠️ E o caso só foi descoberto porque **servidores da CME reclamaram**. Esse é o defeito do
processo, não da capacidade de investigar.

---

## 2. Veredito sobre a proposta original

### 2.1 O que JÁ EXISTE (não construir de novo)

| proposta original | o que já faz isso | desde |
|---|---|---|
| **[Restaurar Batidas e Reconciliar]** | botão **Restaurar Batidas**, dentro do *Preencher pelas Batidas* na grade | v2.73.0, 17/09/2026 |
| **Visão 2 inteira** — varredura do setor + *[Reconciliar Divergências Seguras]* | **Preencher pelas Batidas** (`fn_reconciliacao_pendente_escala` + prévia + critério de acréscimo puro) | v2.49.0/2.50.1, 08/09/2026 |
| **[Alocar na Matrícula Atual]** (duplo vínculo) | resolvido **automaticamente**: sombras do irmão na alocação + `fn_reconciliar_pessoa_dia` | 09/09 e 17/09/2026 |
| **Scanner de buracos de NSR** | `fn_lacunas_afd_parque` + selo e aviso na aba Dispositivos REP | **v2.74.0, hoje** |
| **Status do coletor / último contato / versão** | já na aba Dispositivos REP (`Online`, `Offline há Xh`, versão, host, IP da máquina) | v0.13.0 |
| **Reprocessar AFD** | `fn_reparse_afd_dispositivo` | 22/08/2026 |

🚨 **Um botão novo para o duplo vínculo seria uma regressão, não um ganho.** A alocação decide
entre as duas matrículas por **proximidade ao passo previsto**, com desempate determinístico por
`servidor_id` — é o que garante que **exatamente uma** fica com a batida. Um botão "alocar nesta
matrícula" reintroduz, pela mão do usuário, a dupla contagem que esse desempate existe para
impedir.

### 2.2 O que NÃO PODE existir (remover)

**🚨 [Rebobinar Cursor para Puxar Batidas Faltantes] — remover.** Dois motivos independentes:

1. **É inútil.** O cursor **não é armazenado**: `fn_cursor_afd_dispositivo` o *deriva* a cada
   chamada, como o fim do trecho **contíguo** mais 1. No caso do HMI ele já apontava para 130690 —
   o início exato do buraco — o tempo todo. Não há o que rebobinar; ele nunca esteve errado.
2. **Se alguém o tornasse ajustável, seria a única forma de perder batida.** O CLAUDE.md registra
   a assimetria como deliberada: *"errar o cursor para cima é a única forma de PERDER marcação,
   porque o relógio simplesmente não devolveria as linhas anteriores e nada no sistema
   reclamaria"*. Um campo editável na tela é exatamente essa porta.

**🚨 [Criar Marcação a Partir do AFD Órfão] — remover.** Vincular "o registro bruto ao servidor"
pela tela passa por cima de **`dispositivos_rep.ponto_valido_desde`**, que é a defesa contra o
histórico de relógio reaproveitado virar ponto daqui — 9.626 marcações de 2019–2025 já entraram
por essa porta uma vez. O caminho correto já existe e é outro: corrigir o CPF/PIS ou o vínculo, e
rodar o reparse, que só mexe em órfã.

**⚠️ Gráfico de volume diário com "queda abrupta" — remover.** Volume cai legitimamente em fim de
semana, feriado, férias coletivas e escala reduzida. É heurística onde já existe sinal **exato**
(a lacuna), e alarme falso mata o alerta bom — lição que este projeto já pagou várias vezes.

### 2.3 O que estava CERTO e fica

- O **diagrama das 4 camadas** é correto e vale como documentação.
- A **Visão 1 (por servidor)** é a necessidade real e a única que hoje exige acionar a TI.
- **Somente leitura por padrão**, prévia antes de qualquer ação, nada de batida apagada.
- A ideia de **diagnóstico em linguagem humana** — é o que transforma dado em decisão.

### 2.4 O modo de falha que faltava na tabela

A tabela dos "7 modos" não tem o que causou o caso. Acrescentar:

| camada | causa | o que acontece | sintoma |
|---|---|---|---|
| **2. Ingestão** | **A ingestão falha e desfaz o próprio registro** | o lote não cabe no timeout; a transação reverte inteira, inclusive `rep_sincronizacoes` | **nada** — nem erro, nem log, nem tela. `ultimo_nsr` alto e `Online` |
| **1. Coleta** | **A máquina da unidade não está ligada** | o coletor não pede o AFD; as batidas ficam no relógio | `Offline há Xh`, e **nenhuma lacuna se forma** (não há buraco, só ausência) |

⚠️ **Os dois últimos são complementares e nenhum sinal pega os dois.** A lacuna de NSR pega o
primeiro e é cega para o segundo — com a máquina desligada não existe trecho posterior deixando
buraco atrás. É por isso que a §3.1 existe.

---

## 3. O que construir

### 3.1 🚨 FASE 0 — O sentinela (o que falta e vale mais que todo o resto)

**Pergunta que responde:** *quanto ponto está registrado no relógio e ainda não chegou aqui,
agora, em cada unidade?*

#### (a) O coletor passa a reportar o `last_nsr` do equipamento

✅ **A peça já existe e está órfã.** `rep.InformacoesSistema()` (`rep/client.go`) lê
`get_system_information.fcgi`, cuja resposta traz **`last_nsr`** — e **nenhum caminho do coletor a
chama**. O heartbeat manda versão, host, IP e deriva de relógio; não manda o `last_nsr`.

Com um campo a mais no heartbeat, o servidor passa a saber, **sem tocar na rede da unidade**:

```
batidas_presas = last_nsr (equipamento)  −  ultimo_nsr (ingerido)
```

Isso teria detectado o caso do HMI **no primeiro ciclo**, e não em 38 horas — e detecta também o
caso que a lacuna não pega, porque o número sobrevive ao último heartbeat mesmo depois de a
máquina desligar.

⚠️ **Campo ausente não é zero.** Coletor anterior à versão que o envia não manda nada, e o
servidor precisa distinguir "não sei" de "está tudo em dia" — senão o parque inteiro nasce
aparentando estar perfeito. Guardar `nsr_device_em` junto, como já se faz com `usuarios_lidos_em`.

ℹ️ **Custo:** uma chamada HTTP a mais por ciclo de 5 min, no mesmo `rep.Client` do heartbeat. O
handshake TLS do equipamento custa ~1,1s **dele** e ele serializa — reusar a conexão é ~50× mais
barato, então a chamada tem de sair do client que já está logado, nunca de um novo.

#### (b) Uma verificação diária que AVISA

Roda no cron que já existe e escreve um resumo. Três sinais, todos por **estado**:

| sinal | fonte | o que significa |
|---|---|---|
| **lacuna de NSR** | `fn_lacunas_afd_parque` ✅ *feito* | entregou e não ingeriu — a ingestão está falhando |
| **batidas presas** | `last_nsr` do device × `ultimo_nsr` | registrou e não entregou — a coleta está parada |
| **sem contato** | `ultimo_contato_em` ✅ *já existe* | a máquina não está falando com o servidor |

⚠️ **O aviso precisa ter destinatário.** O projeto já tem canal (e-mail/WhatsApp por
`configuracoes_globais`) e o cron já roda diariamente. Um alerta que só existe numa tela que
ninguém abre é o mesmo silêncio de antes, com mais código.

⚠️ **Limiar e agrupamento, senão vira ruído:** avisar por **unidade**, não por relógio (o HMI tem
3 na mesma máquina e avisaria 3 vezes pelo mesmo problema), e só acima de um piso — máquina de USF
desligada à noite é normal, desligada às 11h de uma sexta não é.

✅ **Extensão real, medida hoje:** dos 35 relógios ativos, **19 estavam com a máquina sem contato
há mais de 2h e 15 há mais de 14h**, com **113 batidas presas** nos 15 que responderam. Nenhuma
dessas aparece como lacuna, e nenhuma seria pega pela ferramenta do plano original.

---

### 3.2 FASE 1 — Visão por servidor (a única tela que falta)

**Pergunta:** *"bati o ponto e estou com traço vermelho — o que houve?"*

É o caso que hoje obriga a acionar a TI, e é o que justifica a ferramenta. Mantida do plano
original, com três cortes.

**Entrada:** nome, matrícula ou CPF + período. **Saída:** uma linha por dia, com turno escalado,
presença na grade, batidas físicas (com relógio, NSR e status) e **o diagnóstico escrito**.

**Diagnósticos, e para onde cada um manda:**

| diagnóstico | o que a tela diz | para onde manda |
|---|---|---|
| 🟢 regular | batida alocada | — |
| 🟡 batida retida | *"existe batida às 07:02 (NSR 12345), retirada de circulação pela reversão de 15/09"* | **Restaurar Batidas**, na grade |
| 🔵 está na outra matrícula | *"a batida das 19:00 está na matrícula 67469; esta escala é da 65562"* | corrigir a **escala**, não a batida |
| 🟣 sem turno compatível | *"batida às 07:10 e o dia está como folga"* | lançamento de escala |
| 🟠 órfã | *"registro no relógio pelo PIS X, sem servidor associado"* | corrigir CPF/PIS → reparse |
| 🔴 não chegou | *"o relógio da unidade tem N batidas ainda não coletadas desde <data>"* | o sentinela da Fase 0 |
| ⚪ nunca reconciliado | *"a batida existe e o dia nunca foi projetado"* | **Preencher pelas Batidas** |

🚨 **A tela é SOMENTE LEITURA e não ganha botão de reparo próprio.** Ela **diagnostica e leva** às
ações que já existem, cada uma com a prévia e o guard delas. Duplicar as ações aqui criaria um
segundo caminho de escrita sobre ponto — e este projeto já registra, em três armadilhas separadas,
o que acontece quando um caminho novo de escrita não passa pelas mesmas validações.

⚠️ **O diagnóstico 🔴 é o que fecha o ciclo com a Fase 0**: é ele que transforma "sumiu" em "está
no relógio e ainda não veio", que é a diferença entre o coordenador esperar e o coordenador
digitar horário à mão em cima de batida que existe.

**Cuidado de desempenho, não opcional:** `rep_afd_registros` tem **3,17 milhões** de linhas, e a
Cobertura de Ponto já viveu a 1,4s do `statement_timeout` por falta de índice pelo caminho certo.
A função tem de ser **estreita por construção** — um servidor, poucos dias — e nunca aceitar "o
setor inteiro do mês". Medir com `EXPLAIN` antes de publicar, e rodar `ANALYZE` se o parque tiver
crescido em rajada.

---

### 3.3 FASE 2 — O que sobra da visão por relógio

Depois do que a v2.74.0 entregou, resta pouco, e o pouco é útil:

- **histórico da lacuna** — não só "tem agora", mas "já teve N vezes nos últimos 30 dias". Relógio
  que trava toda semana é problema de máquina ou de rede, não de azar.
- **as últimas sincronizações**, com NSR, linhas e marcações. Já existe em `rep_sincronizacoes`;
  falta exibir.

⚠️ **Nada nessa aba toca no equipamento.** O relógio está em `10.x.x.x`, dentro da unidade; a VPS
do Coolify não tem rota até lá, e um teste server-side falharia sempre, com qualquer credencial. É
a mesma razão pela qual não existe botão "Testar conexão". Diagnóstico contra o hardware é da CLI,
rodando numa máquina dentro da rede.

ℹ️ De uma máquina da SMS **dá** para alcançar os relógios das outras unidades (a rede `10.110.x.x`
é roteada — medido hoje: 2 ms até o HMI). Isso serve para **operação manual da TI**, não para a
tela.

---

## 4. Estado atual

| peça | estado |
|---|---|
| lacuna de NSR detectada e exibida | ✅ **v2.74.0**, `fn_lacunas_afd_parque` + selo e aviso na aba Dispositivos REP |
| causa-raiz do caso do HMI corrigida | ✅ **v2.74.0** (reconciliação duplicada removida; coletor v0.18.0 com lote adaptativo) |
| `last_nsr` do equipamento no heartbeat | ✅ **v2.75.0** — coletor **v0.19.0**; `dispositivos_rep.nsr_device` (`20260919110000`) |
| verificação diária que avisa | ✅ **v2.75.0** — `vigiarColetaDoParque`, etapa 4 de `/api/cron`, e-mail agrupado por unidade |
| visão por servidor | ✅ **v2.75.0** — `fn_auditoria_ponto_servidor` (`20260919120000`) + aba **Investigar Ponto** |
| histórico de lacunas por relógio | ❌ **a fazer** (§3.3) — pelo critério do próprio plano, só se a vigilância mostrar reincidência |
| ~~visão por setor~~ | ⬛ **removida** — é o *Preencher pelas Batidas* |
| ~~rebobinar cursor~~ | ⬛ **removida** — inútil e perigosa (§2.2) |
| ~~criar marcação de órfã pela tela~~ | ⬛ **removida** — contorna `ponto_valido_desde` (§2.2) |
| ~~alocar na matrícula irmã~~ | ⬛ **removida** — reintroduz dupla contagem (§2.1) |
| ~~gráfico de volume diário~~ | ⬛ **removida** — heurística onde há sinal exato (§2.2) |

## 5. Ordem sugerida

1. **§3.1a** — `last_nsr` no heartbeat. Menor esforço do plano inteiro (um campo, uma coluna) e o
   maior ganho de detecção: fecha o ponto cego que sobrou depois da v2.74.0.
2. **§3.1b** — a verificação diária com aviso. Sem ela o item 1 é só mais um número numa tela.
   ⚠️ **Exige a chave `vigilancia_ponto_emails` em Configurações.** Sem ela a verificação roda, mede e **não envia** — o número sai na resposta do cron, mas ninguém é avisado, que é o silêncio de sempre com mais código.
3. **§3.2** — visão por servidor, somente leitura. É o que tira a TI do meio da contestação.
4. **§3.3** — histórico por relógio, se o item 2 mostrar que há reincidência.

⚠️ **Fazer o 3 antes do 1 e do 2 é repetir o erro do plano original**: investigar melhor um
problema que ninguém sabe que está acontecendo.

## 6. Papéis

O plano original dá a ferramenta a coordenadores. **Isso muda o modelo de acesso e precisa ser
decisão explícita**: `/marcacoes` hoje é do RH Geral, RH da Unidade, Diretor e Administrador Geral
(`fn_escopo_gestao_alcanca`), e o coordenador trabalha pela grade, onde já tem o *Preencher pelas
Batidas* e o modal de validação.

Recomendação: **Fase 0 e 1 no escopo atual de `/marcacoes`**. Se a contestação individual precisar
chegar ao coordenador, o lugar natural é a **própria grade**, na célula — não uma aba de auditoria
de equipamento.
